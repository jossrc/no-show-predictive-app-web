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
import { assessBookingEvidence } from '../validation/AssessBookingEvidence.js';
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
 * 2) (solo READ_ONLY_EXISTING_SCHEDULE) evidencia de la réplica, si demuestra el estado al reservar;
 * 3) en otro caso NOT_SCORABLE con motivos. Nunca reconstruye con datos que pudieron cambiar.
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

    if (this.mode === 'SYNTHETIC_DEMO_ONLY') {
      return { kind: 'NOT_SCORABLE', reasons: [notScorableReason('NO_USABLE_SNAPSHOT_IN_MODE')] };
    }

    const evidence = await this.evidenceSource.load(reservation.reservationId);
    if (!evidence) {
      return { kind: 'NOT_SCORABLE', reasons: [notScorableReason('RESERVATION_NOT_SCHEDULED')] };
    }

    const assessment = assessBookingEvidence(evidence);
    return assessment.kind === 'VERIFIED'
      ? {
          kind: 'VERIFIED_SOURCE',
          verified: assessment.snapshot,
          sourceIngestionBatchId: evidence.sourceIngestionBatchId,
        }
      : assessment;
  }
}
