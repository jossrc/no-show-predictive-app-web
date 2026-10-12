import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { BookingEvidence } from '../models/BookingEvidence.js';

/**
 * Lee lo necesario para evaluar la foto de reserva: raw_flow/analytics (solo lectura) en modo
 * real, o fixtures sintéticas versionadas en SYNTHETIC_DEMO_ONLY.
 */
export interface BookingEvidenceSource {
  /** Única clase de evidencia que esta fuente puede producir (los modos nunca se mezclan). */
  readonly snapshotEvidenceSource: SnapshotEvidenceSource;
  /**
   * Capacidad de la fuente: si sus líneas de servicio tienen evidencia temporal de la reserva.
   * La réplica actual (diary_det / appointment_services) no la tiene.
   */
  readonly servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' | 'CAPTURED_AT_BOOKING';
  load(reservationId: DecimalId): Promise<BookingEvidence | null>;
}
