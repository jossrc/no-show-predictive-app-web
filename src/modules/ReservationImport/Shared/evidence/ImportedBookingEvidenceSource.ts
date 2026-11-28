import {
  allowedSnapshotEvidence,
  type DataSourceMode,
  type SnapshotEvidenceSource,
} from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  BookingEvidence,
  EvidenceServiceLine,
  ServicesTemporalEvidence,
} from '../../../ReservationRisk/Shared/models/BookingEvidence.js';
import type { BookingEvidenceSource } from '../../../ReservationRisk/Shared/persistence/BookingEvidenceSource.js';
import type { ImportedReservation } from '../models/ImportedReservation.js';
import type { ImportReferenceReader } from '../persistence/ImportReferenceReader.js';
import type { ImportedReservationRepository } from '../persistence/ImportedReservationRepository.js';

/**
 * Regla de FLOWww (la misma que aplica la réplica): toda modificación de fecha, hora o servicios
 * deja una copia histórica con DiaryGDelayedID. Sin copias (`cantidad_reprogramaciones` = 0) los
 * servicios y el horario siguen siendo los de la reserva; con copias, el archivo no trae la
 * versión original, así que no se acredita la foto al reservar.
 */
function temporalEvidence(reservation: ImportedReservation): ServicesTemporalEvidence {
  return reservation.rescheduleCount === 0 ? 'FLOWWW_UNCHANGED_BOOKING' : 'NONE_CURRENT_REPLICA';
}

/**
 * Evidencia de una reserva incorporada para el flujo predictivo EXISTENTE (AssessBookingEvidence
 * → RiskFeaturesBuilder → BOOKING_BASELINE_V1). Atributos del cliente, catálogo e historial se
 * leen de la fuente del modo activo; nada se rellena: lo que falte produce NOT_SCORABLE.
 */
export class ImportedBookingEvidenceSource implements BookingEvidenceSource {
  readonly snapshotEvidenceSource: SnapshotEvidenceSource;

  constructor(
    private readonly imported: Pick<ImportedReservationRepository, 'findByReservationId'>,
    private readonly references: ImportReferenceReader,
    mode: DataSourceMode,
  ) {
    this.snapshotEvidenceSource = allowedSnapshotEvidence(mode);
  }

  async load(reservationId: DecimalId): Promise<BookingEvidence | null> {
    const reservation = await this.imported.findByReservationId(reservationId);
    if (!reservation) return null;
    // La fuente principal prevalece si llegó a registrar el mismo identificador.
    if ((await this.references.existingReservationIds([reservationId])).has(reservationId)) {
      return null;
    }

    const [client, products, historyCoveredUntil] = await Promise.all([
      this.references.client(reservation.clientId),
      this.references.products([...new Set(reservation.serviceProductIds)]),
      this.references.historyCoveredUntil(),
    ]);
    const services: EvidenceServiceLine[] = reservation.serviceProductIds.map(
      (productId, index) => {
        const product = products.get(productId);
        return {
          // Sin DiaryID en el contrato: la línea se identifica por su posición en la fila.
          sourceDetailId: String(index + 1),
          productId,
          productType: product?.productType ?? null,
          bodyAreaProductId: product?.bodyAreaProductId ?? null,
          isMedicalEvaluation: product?.isMedicalEvaluation ?? null,
          productFound: product !== undefined,
          catalogResolved: product?.catalogResolved === true,
        };
      },
    );

    return {
      reservationId: reservation.reservationId,
      clientId: reservation.clientId,
      clinicId: reservation.clinicId,
      reservationStatus: reservation.status,
      bookingCreatedAt: reservation.bookingCreatedAt,
      appointmentAt: reservation.appointmentAt,
      appointmentEndAt: reservation.appointmentEndAt,
      fwaFlag: reservation.fwaFlag,
      hasRescheduleEvent: reservation.rescheduleCount > 0,
      historicalVersions: [],
      reconstructedOriginal: null,
      client,
      services,
      servicesTemporalEvidence: temporalEvidence(reservation),
      sourceIngestionBatchId: reservation.batchId,
      evidenceSource: this.snapshotEvidenceSource,
      historyCoveredUntil,
      evidenceTables: this.references.evidenceTables,
    };
  }
}
