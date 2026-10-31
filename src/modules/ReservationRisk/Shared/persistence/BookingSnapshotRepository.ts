import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  BookingFeatureSnapshot,
  NewBookingFeatureSnapshot,
} from '../models/BookingFeatureSnapshot.js';

export interface BookingSnapshotRepository {
  /** Snapshot más reciente de la reserva con la evidencia admitida en el modo activo. */
  findLatestUsable(
    reservationId: DecimalId,
    evidence: SnapshotEvidenceSource,
  ): Promise<BookingFeatureSnapshot | null>;
  /** Inserta si no existe (UNIQUE reservation_id+snapshot_hash) y devuelve el registro vigente. */
  saveIfAbsent(snapshot: NewBookingFeatureSnapshot): Promise<BookingFeatureSnapshot>;
}
