import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SourceDataUnavailableException } from '../../../../../infrastructure/database/errors/SourceDataUnavailableException.js';
import { runInReadOnlySnapshot } from '../../../../../infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import { deriveReservationStatus } from '../../../../Reservations/Shared/models/ReservationStatus.js';
import type { BookingEvidence, EvidenceServiceLine } from '../../models/BookingEvidence.js';
import type { BookingEvidenceSource } from '../BookingEvidenceSource.js';

/**
 * Timestamps de FLOWww son hora de pared de Lima (timestamp sin zona): se convierten con
 * AT TIME ZONE 'America/Lima', igual que los ETL 01/13/14.
 */
const FACTS_SQL = `
SELECT o.appointment_id::text AS reservation_id,
       o.client_id::text AS client_id,
       o.clinic_id AS clinic_id,
       o.outcome::text AS outcome,
       o.classification_detail::text AS classification_detail,
       o.created_at_source AS created_at_source,
       o.appointment_at AS appointment_at,
       CASE WHEN d."DiaryGDate" IS NOT NULL AND d."DiaryGEnd" IS NOT NULL
            THEN (d."DiaryGDate" + d."DiaryGEnd") AT TIME ZONE 'America/Lima' END AS appointment_end_at,
       d."DiaryGFWA" AS fwa_flag,
       d._ingestion_batch_id::text AS ingestion_batch_id,
       c."ClientID" IS NOT NULL AS client_found,
       c."ClientBirthDate"::text AS client_birth_date,
       c."ClientSex" AS client_sex,
       c."ClientStamp" AT TIME ZONE 'America/Lima' AS client_last_modified_at,
       (EXISTS (
          SELECT 1 FROM analytics.appointment_events e
          WHERE e.appointment_id = o.appointment_id AND e.event_type = 'RESCHEDULED'
            AND e.event_at IS NOT NULL
        ) OR EXISTS (
          SELECT 1 FROM raw_flow.diary_gen h
          WHERE h."DiaryGDelayedID" = o.appointment_id AND h."DiaryGDelayed" = -1
        )) AS has_reschedule_event
FROM analytics.appointment_outcomes o
JOIN raw_flow.diary_gen d ON d."DiaryGID" = o.appointment_id
LEFT JOIN raw_flow.clients c ON c."ClientID" = o.client_id
WHERE o.appointment_id = $1::bigint`;

/** Misma fuente que el ETL 14 (appointment_services SCHEDULED + product_catalog_resolution). */
const SERVICES_SQL = `
SELECT s.source_detail_id::text AS source_detail_id,
       s.product_id::text AS product_id,
       s.product_type AS product_type,
       s.is_medical_evaluation AS is_medical_evaluation,
       p."ProductID" IS NOT NULL AS product_found,
       r.product_id IS NOT NULL AS catalog_resolved,
       r.body_area_product_id::text AS body_area_product_id,
       p."ProductStamp" AT TIME ZONE 'America/Lima' AS product_modified_at,
       CASE WHEN r.voucher_zone_product_id IS NULL THEN NULL
            ELSE z."ProductStamp" AT TIME ZONE 'America/Lima' END AS zone_modified_at,
       r.voucher_zone_product_id IS NOT NULL AS has_zone,
       CASE WHEN r.body_area_product_id IS NULL THEN NULL
            ELSE ba."ProductStamp" AT TIME ZONE 'America/Lima' END AS body_area_modified_at,
       r.body_area_product_id IS NOT NULL AS has_body_area
FROM analytics.appointment_services s
LEFT JOIN analytics.product_catalog_resolution r ON r.product_id = s.product_id
LEFT JOIN raw_flow.x_config_products_det p ON p."ProductID" = s.product_id
LEFT JOIN raw_flow.x_config_products_det z ON z."ProductID" = r.voucher_zone_product_id
LEFT JOIN raw_flow.x_config_products_det ba ON ba."ProductID" = r.body_area_product_id
WHERE s.appointment_id = $1::bigint AND s.service_phase = 'SCHEDULED'
ORDER BY s.source_detail_id`;

interface FactsRow {
  reservation_id: string;
  client_id: string;
  clinic_id: number;
  outcome: string;
  classification_detail: string | null;
  created_at_source: Date | null;
  appointment_at: Date;
  appointment_end_at: Date | null;
  fwa_flag: number | null;
  ingestion_batch_id: string | null;
  client_found: boolean;
  client_birth_date: string | null;
  client_sex: string | null;
  client_last_modified_at: Date | null;
  has_reschedule_event: boolean;
}

interface ServiceRow {
  source_detail_id: string;
  product_id: string | null;
  product_type: number | null;
  is_medical_evaluation: boolean | null;
  product_found: boolean;
  catalog_resolved: boolean;
  body_area_product_id: string | null;
  product_modified_at: Date | null;
  zone_modified_at: Date | null;
  has_zone: boolean;
  body_area_modified_at: Date | null;
  has_body_area: boolean;
}

function mapService(row: ServiceRow): EvidenceServiceLine {
  const stamps: (Date | null)[] = [row.product_modified_at];
  if (row.has_zone) stamps.push(row.zone_modified_at);
  if (row.has_body_area) stamps.push(row.body_area_modified_at);

  return {
    sourceDetailId: row.source_detail_id,
    productId: row.product_id,
    productType: row.product_type === null ? null : Number(row.product_type),
    bodyAreaProductId: row.body_area_product_id,
    isMedicalEvaluation: row.is_medical_evaluation,
    productFound: row.product_found === true,
    catalogResolved: row.catalog_resolved === true,
    catalogLastModifiedAt: stamps,
  };
}

export class SequelizeBookingEvidenceSource implements BookingEvidenceSource {
  // diary_det / appointment_services no registran cuándo se creó cada línea.
  readonly servicesTemporalEvidence = 'NONE_CURRENT_REPLICA' as const;
  readonly snapshotEvidenceSource = 'VERIFIED_BOOKING_SNAPSHOT' as const;

  constructor(
    private readonly sequelize: Sequelize,
    private readonly statementTimeoutMs: number,
  ) {}

  async load(reservationId: string): Promise<BookingEvidence | null> {
    try {
      return await runInReadOnlySnapshot(
        this.sequelize,
        { statementTimeoutMs: this.statementTimeoutMs },
        (transaction) => this.loadInSnapshot(reservationId, transaction),
      );
    } catch (error) {
      throw new SourceDataUnavailableException({ operation: 'LoadBookingEvidence', cause: error });
    }
  }

  private async loadInSnapshot(
    reservationId: string,
    transaction: Transaction,
  ): Promise<BookingEvidence | null> {
    const [facts] = await this.sequelize.query<FactsRow>(FACTS_SQL, {
      bind: [reservationId],
      type: QueryTypes.SELECT,
      transaction,
    });
    if (!facts) return null;

    const status = deriveReservationStatus(facts.outcome, facts.classification_detail);
    if (status === null) return null;

    const services = await this.sequelize.query<ServiceRow>(SERVICES_SQL, {
      bind: [reservationId],
      type: QueryTypes.SELECT,
      transaction,
    });

    return {
      reservationId: facts.reservation_id,
      clientId: facts.client_id,
      clinicId: Number(facts.clinic_id),
      reservationStatus: status,
      bookingCreatedAt: facts.created_at_source,
      appointmentAt: facts.appointment_at,
      appointmentEndAt: facts.appointment_end_at,
      fwaFlag: facts.fwa_flag === null ? null : Number(facts.fwa_flag),
      hasRescheduleEvent: facts.has_reschedule_event === true,
      client: facts.client_found
        ? {
            birthDate: facts.client_birth_date,
            sex: facts.client_sex,
            lastModifiedAt: facts.client_last_modified_at,
          }
        : null,
      services: services.map(mapService),
      servicesTemporalEvidence: this.servicesTemporalEvidence,
      sourceIngestionBatchId: facts.ingestion_batch_id,
      evidenceSource: this.snapshotEvidenceSource,
    };
  }
}
