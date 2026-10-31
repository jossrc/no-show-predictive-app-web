import { PersistenceUnavailableException } from '../../../../infrastructure/database/errors/PersistenceUnavailableException.js';
import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type { BookingFeatureSnapshot } from '../models/BookingFeatureSnapshot.js';
import { notScorableReason, type NotScorableReason } from '../models/NotScorableReason.js';
import type { VerifiedBookingSnapshot } from '../models/VerifiedBookingSnapshot.js';
import type { BookingEvidenceSource } from '../persistence/BookingEvidenceSource.js';
import type { BookingSnapshotRepository } from '../persistence/BookingSnapshotRepository.js';
import {
  assessBookingEvidence,
  scoringSchedule,
} from '../validation/AssessBookingEvidence.js';
import { verifySnapshotIntegrity } from './VerifySnapshotIntegrity.js';

export type BookingSnapshotResolution =
  | { readonly kind: 'STORED'; readonly snapshot: BookingFeatureSnapshot }
  | {
      readonly kind: 'VERIFIED_SOURCE';
      readonly verified: VerifiedBookingSnapshot;
      readonly sourceIngestionBatchId: string | null;
    }
  | { readonly kind: 'NOT_SCORABLE'; readonly reasons: readonly NotScorableReason[] };

/**
 * Localiza la foto de reserva utilizable:
 * 1) snapshot inmutable ya persistido con la evidencia admitida por el modo activo;
 * 2) evidencia de la fuente del MISMO modo (réplica real si demuestra el estado al reservar, o
 *    fixture sintética versionada en SYNTHETIC_DEMO_ONLY); una fuente de otro modo se rechaza;
 *    FLOWww acredita los servicios sin cambios por ausencia de copias, o reconstruye la primera
 *    versión (FLOWWW_RECONSTRUCTED_BOOKING) para el contrato booking_creation;
 * 3) en otro caso NOT_SCORABLE con motivos. No usa el horario ni los servicios vigentes de una
 *    cita reprogramada: las 19 variables se calculan sobre la versión original reconstruida.
 */
export class BookingSnapshotResolver {
  constructor(
    private readonly snapshots: BookingSnapshotRepository,
    private readonly evidenceSource: BookingEvidenceSource,
    private readonly mode: DataSourceMode,
  ) {}

  async findStored(reservation: Reservation): Promise<BookingFeatureSnapshot | null> {
    let stored: BookingFeatureSnapshot | null;
    try {
      stored = await this.snapshots.findLatestUsable(
        reservation.reservationId,
        allowedSnapshotEvidence(this.mode),
      );
    } catch (error) {
      // Lectura: sin `npm run migrate:app` no puede existir ningún snapshot persistido. Se
      // continúa con la evaluación de evidencia (las escrituras sí fallan con 503).
      if (
        error instanceof PersistenceUnavailableException &&
        error.metadata?.reason === 'PREDICTIVE_SCHEMA_NOT_MIGRATED'
      ) {
        return null;
      }
      throw error;
    }
    return stored ? verifySnapshotIntegrity(stored, reservation.reservationId) : null;
  }

  async resolve(reservation: Reservation): Promise<BookingSnapshotResolution> {
    const stored = await this.findStored(reservation);
    if (stored) return { kind: 'STORED', snapshot: stored };

    const allowed = allowedSnapshotEvidence(this.mode);
    if (this.evidenceSource.snapshotEvidenceSource !== allowed) {
      return { kind: 'NOT_SCORABLE', reasons: [notScorableReason('NO_USABLE_SNAPSHOT_IN_MODE')] };
    }

    const evidence = await this.evidenceSource.load(reservation.reservationId);
    if (!evidence) {
      return { kind: 'NOT_SCORABLE', reasons: [notScorableReason('RESERVATION_NOT_SCHEDULED')] };
    }
    if (evidence.evidenceSource !== allowed) {
      return { kind: 'NOT_SCORABLE', reasons: [notScorableReason('NO_USABLE_SNAPSHOT_IN_MODE')] };
    }

    const assessment = assessBookingEvidence(evidence);
    if (assessment.kind !== 'VERIFIED') return assessment;

    const schedule = scoringSchedule(evidence);
    return {
      kind: 'VERIFIED_SOURCE',
      verified: {
        ...assessment.snapshot,
        appointmentAt: schedule.appointmentAt,
        appointmentEndAt: schedule.appointmentEndAt,
        scheduledServices: schedule.services.map((line) => ({
          sourceDetailId: line.sourceDetailId,
          productId: line.productId,
          productType: line.productType,
          bodyAreaProductId: line.bodyAreaProductId,
          isMedicalEvaluation: line.isMedicalEvaluation,
        })),
      },
      sourceIngestionBatchId: evidence.sourceIngestionBatchId,
    };
  }
}
