import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SourceDataUnavailableException } from '../../../../../infrastructure/database/errors/SourceDataUnavailableException.js';
import { runInReadOnlySnapshot } from '../../../../../infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import { deriveReservationStatus } from '../../../../Reservations/Shared/models/ReservationStatus.js';
import type {
  BookingEvidence,
  EvidenceServiceLine,
  HistoricalBookingVersion,
  HistoricalServiceLine,
  ReconstructedOriginalBooking,
  ServicesTemporalEvidence,
} from '../../models/BookingEvidence.js';
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
       d."DiaryGNotAttended" = -1 AS cancelled,
       d._ingestion_batch_id::text AS ingestion_batch_id,
       c."ClientID" IS NOT NULL AS client_found,
       c."ClientBirthDate"::text AS client_birth_date,
       c."ClientSex" AS client_sex,
       c."ClientStamp" AT TIME ZONE 'America/Lima' AS client_last_modified_at,
       (EXISTS (
          SELECT 1 FROM analytics.appointment_events e
          WHERE e.appointment_id = o.appointment_id AND e.event_type = 'RESCHEDULED'
        )) AS has_reschedule_event
FROM analytics.appointment_outcomes o
JOIN raw_flow.diary_gen d ON d."DiaryGID" = o.appointment_id
LEFT JOIN raw_flow.clients c ON c."ClientID" = o.client_id
WHERE o.appointment_id = $1::bigint
  AND d."DiaryGLocked" <> -1 AND d."DiaryGDelayed" <> -1
  AND NOT (d."DiaryGTags" ~ '(^|[^0-9])16([^0-9]|$)')`;

/**
 * FLOWww conserva cada versión previa bajo su propio DiaryGID. La cronología de copias usa
 * DiaryGStamp/DiaryGCreated de cada copia (no el DiaryGID vigente). EXCEPT ALL compara
 * composición y multiplicidad, sin confundir IDs de líneas copiados.
 */
const HISTORY_SQL = `
SELECT h."DiaryGID"::text AS reservation_id,
       h."DiaryGDelayedID"::text AS original_reservation_id,
       CASE WHEN h."DiaryGDate" IS NOT NULL AND h."DiaryGStart" IS NOT NULL
            THEN (h."DiaryGDate" + h."DiaryGStart") AT TIME ZONE 'America/Lima' END AS appointment_at,
       CASE WHEN h."DiaryGDate" IS NOT NULL AND h."DiaryGEnd" IS NOT NULL
            THEN (h."DiaryGDate" + h."DiaryGEnd") AT TIME ZONE 'America/Lima' END AS appointment_end_at,
       h."DiaryGCreated" AT TIME ZONE 'America/Lima' AS version_created_at,
       h."DiaryGStamp" AT TIME ZONE 'America/Lima' AS version_stamp_at,
       (h."DiaryGDate" IS DISTINCT FROM d."DiaryGDate"
        OR h."DiaryGStart" IS DISTINCT FROM d."DiaryGStart"
        OR h."DiaryGEnd" IS DISTINCT FROM d."DiaryGEnd") AS schedule_changed,
       EXISTS (
         (SELECT x."DiaryZoneID", x."DiaryPackID", x."DiaryVoucherID", x."DiarySessionID"
          FROM raw_flow.diary_det x WHERE x."DiaryGID" = h."DiaryGID"
          EXCEPT ALL
          SELECT x."DiaryZoneID", x."DiaryPackID", x."DiaryVoucherID", x."DiarySessionID"
          FROM raw_flow.diary_det x WHERE x."DiaryGID" = d."DiaryGID")
         UNION ALL
         (SELECT x."DiaryZoneID", x."DiaryPackID", x."DiaryVoucherID", x."DiarySessionID"
          FROM raw_flow.diary_det x WHERE x."DiaryGID" = d."DiaryGID"
          EXCEPT ALL
          SELECT x."DiaryZoneID", x."DiaryPackID", x."DiaryVoucherID", x."DiarySessionID"
          FROM raw_flow.diary_det x WHERE x."DiaryGID" = h."DiaryGID")
       ) AS services_changed,
       dd."DiaryID"::text AS source_detail_id,
       NULLIF(dd."DiaryZoneID", 0)::text AS product_id,
       dd."DiaryPackID"::text AS pack_id,
       dd."DiaryVoucherID"::text AS voucher_id,
       dd."DiarySessionID" AS planned_session_number,
       p."ProductID" IS NOT NULL AS product_found,
       r.product_id IS NOT NULL AS catalog_resolved,
       p."ProductType" AS product_type,
       r.body_area_product_id::text AS body_area_product_id,
       CASE WHEN p."ProductID" IS NULL THEN NULL ELSE p."ProductEvaluation" <> 0 END AS is_medical_evaluation
FROM raw_flow.diary_gen h
JOIN raw_flow.diary_gen d ON d."DiaryGID" = h."DiaryGDelayedID"
LEFT JOIN raw_flow.diary_det dd ON dd."DiaryGID" = h."DiaryGID"
LEFT JOIN raw_flow.x_config_products_det p ON p."ProductID" = NULLIF(dd."DiaryZoneID", 0)
LEFT JOIN analytics.product_catalog_resolution r ON r.product_id = NULLIF(dd."DiaryZoneID", 0)
WHERE h."DiaryGDelayedID" = $1::bigint AND h."DiaryGDelayed" = -1
ORDER BY h."DiaryGStamp" NULLS LAST, h."DiaryGCreated" NULLS LAST, h."DiaryGID", dd."DiaryID"`;

/** Misma fuente que el ETL 14 (appointment_services SCHEDULED + product_catalog_resolution). */
const SERVICES_SQL = `
SELECT s.source_detail_id::text AS source_detail_id,
       s.product_id::text AS product_id,
       s.product_type AS product_type,
       s.is_medical_evaluation AS is_medical_evaluation,
       p."ProductID" IS NOT NULL AS product_found,
       r.product_id IS NOT NULL AS catalog_resolved,
       r.body_area_product_id::text AS body_area_product_id
FROM analytics.appointment_services s
LEFT JOIN analytics.product_catalog_resolution r ON r.product_id = s.product_id
LEFT JOIN raw_flow.x_config_products_det p ON p."ProductID" = s.product_id
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
  cancelled: boolean;
}

interface HistoryRow {
  reservation_id: string;
  original_reservation_id: string;
  appointment_at: Date | null;
  appointment_end_at: Date | null;
  version_created_at: Date | null;
  version_stamp_at: Date | null;
  schedule_changed: boolean;
  services_changed: boolean;
  source_detail_id: string | null;
  product_id: string | null;
  pack_id: string | null;
  voucher_id: string | null;
  planned_session_number: number | null;
  product_found: boolean | null;
  catalog_resolved: boolean | null;
  product_type: number | null;
  body_area_product_id: string | null;
  is_medical_evaluation: boolean | null;
}

function mapHistoricalService(row: HistoryRow): HistoricalServiceLine {
  return {
    sourceDetailId: row.source_detail_id!,
    productId: row.product_id,
    packId: row.pack_id ?? '0',
    voucherId: row.voucher_id ?? '0',
    plannedSessionNumber: Number(row.planned_session_number ?? 0),
    productType: row.product_type === null ? null : Number(row.product_type),
    bodyAreaProductId: row.body_area_product_id,
    isMedicalEvaluation: row.is_medical_evaluation,
    productFound: row.product_found === true,
    catalogResolved: row.catalog_resolved === true,
  };
}

function mapHistoricalVersions(rows: readonly HistoryRow[]): HistoricalBookingVersion[] {
  const versions = new Map<string, HistoricalBookingVersion>();
  for (const row of rows) {
    const version = versions.get(row.reservation_id) ?? {
      reservationId: row.reservation_id,
      originalReservationId: row.original_reservation_id,
      appointmentAt: row.appointment_at,
      appointmentEndAt: row.appointment_end_at,
      versionCreatedAt: row.version_created_at,
      versionStampAt: row.version_stamp_at,
      scheduleChanged: row.schedule_changed === true,
      servicesChanged: row.services_changed === true,
      services: [],
    };
    versions.set(row.reservation_id, {
      ...version,
      services:
        row.source_detail_id === null
          ? version.services
          : [...version.services, mapHistoricalService(row)],
    });
  }
  return [...versions.values()];
}

function versionTime(version: HistoricalBookingVersion): Date | null {
  return version.versionStampAt ?? version.versionCreatedAt;
}

/** Primera copia en el tiempo real de congelado; DiaryGID solo desempatan instantes iguales. */
function pickOriginalVersion(
  versions: readonly HistoricalBookingVersion[],
): HistoricalBookingVersion | null {
  if (versions.length === 0) return null;
  if (versions.length === 1) return versions[0]!;
  if (versions.some((version) => versionTime(version) === null)) return null;
  return [...versions].sort((left, right) => {
    const delta = versionTime(left)!.getTime() - versionTime(right)!.getTime();
    if (delta !== 0) return delta;
    return left.reservationId < right.reservationId ? -1 : 1;
  })[0]!;
}

function toEvidenceServiceLine(line: HistoricalServiceLine): EvidenceServiceLine {
  return {
    sourceDetailId: line.sourceDetailId,
    productId: line.productId,
    productType: line.productType,
    bodyAreaProductId: line.bodyAreaProductId,
    isMedicalEvaluation: line.isMedicalEvaluation,
    productFound: line.productFound,
    catalogResolved: line.catalogResolved,
  };
}

function reconstructOriginalBooking(
  versions: readonly HistoricalBookingVersion[],
): ReconstructedOriginalBooking | null {
  const original = pickOriginalVersion(versions);
  if (original === null || original.appointmentAt === null) return null;
  return {
    sourceVersionId: original.reservationId,
    appointmentAt: original.appointmentAt,
    appointmentEndAt: original.appointmentEndAt,
    services: original.services.map(toEvidenceServiceLine),
  };
}

function temporalEvidence(input: {
  historicalVersions: readonly HistoricalBookingVersion[];
  hasRescheduleEvent: boolean;
  reconstructedOriginal: ReconstructedOriginalBooking | null;
}): ServicesTemporalEvidence {
  if (input.historicalVersions.length === 0 && !input.hasRescheduleEvent) {
    return 'FLOWWW_UNCHANGED_BOOKING';
  }
  if (input.reconstructedOriginal !== null) return 'FLOWWW_RECONSTRUCTED_BOOKING';
  return 'NONE_CURRENT_REPLICA';
}

interface ServiceRow {
  source_detail_id: string;
  product_id: string | null;
  product_type: number | null;
  is_medical_evaluation: boolean | null;
  product_found: boolean;
  catalog_resolved: boolean;
  body_area_product_id: string | null;
}

function mapService(row: ServiceRow): EvidenceServiceLine {
  return {
    sourceDetailId: row.source_detail_id,
    productId: row.product_id,
    productType: row.product_type === null ? null : Number(row.product_type),
    bodyAreaProductId: row.body_area_product_id,
    isMedicalEvaluation: row.is_medical_evaluation,
    productFound: row.product_found === true,
    catalogResolved: row.catalog_resolved === true,
  };
}

export class SequelizeBookingEvidenceSource implements BookingEvidenceSource {
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

    const historicalVersions = mapHistoricalVersions(
      await this.sequelize.query<HistoryRow>(HISTORY_SQL, {
        bind: [reservationId],
        type: QueryTypes.SELECT,
        transaction,
      }),
    );
    const hasRescheduleEvent =
      facts.has_reschedule_event === true ||
      historicalVersions.some((version) => version.scheduleChanged);
    const reconstructedOriginal = reconstructOriginalBooking(historicalVersions);

    const services = await this.sequelize.query<ServiceRow>(SERVICES_SQL, {
      bind: [reservationId],
      type: QueryTypes.SELECT,
      transaction,
    });

    return {
      reservationId: facts.reservation_id,
      clientId: facts.client_id,
      clinicId: Number(facts.clinic_id),
      reservationStatus: status === 'SCHEDULED' && facts.cancelled ? 'CANCELLED' : status,
      bookingCreatedAt: facts.created_at_source,
      appointmentAt: facts.appointment_at,
      appointmentEndAt: facts.appointment_end_at,
      fwaFlag: facts.fwa_flag === null ? null : Number(facts.fwa_flag),
      hasRescheduleEvent,
      historicalVersions,
      reconstructedOriginal,
      client: facts.client_found
        ? {
            birthDate: facts.client_birth_date,
            sex: facts.client_sex,
            lastModifiedAt: facts.client_last_modified_at,
          }
        : null,
      services: services.map(mapService),
      servicesTemporalEvidence: temporalEvidence({
        historicalVersions,
        hasRescheduleEvent,
        reconstructedOriginal,
      }),
      sourceIngestionBatchId: facts.ingestion_batch_id,
      evidenceSource: this.snapshotEvidenceSource,
    };
  }
}
