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
  // La evidencia temporal se determina por reserva en load(), nunca por toda la fuente.
  load(reservationId: DecimalId): Promise<BookingEvidence | null>;
}
