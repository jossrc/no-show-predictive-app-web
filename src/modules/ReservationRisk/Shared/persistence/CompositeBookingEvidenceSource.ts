import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { BookingEvidence } from '../models/BookingEvidence.js';
import type { BookingEvidenceSource } from './BookingEvidenceSource.js';

/**
 * Evidencia de la fuente principal y, si no la tiene, de una fuente adicional del MISMO modo de
 * datos (reservas incorporadas por archivo). Ambas deben declarar la misma clase de evidencia:
 * los modos real y sintético nunca se mezclan.
 */
export class CompositeBookingEvidenceSource implements BookingEvidenceSource {
  readonly snapshotEvidenceSource: SnapshotEvidenceSource;

  constructor(
    private readonly primary: BookingEvidenceSource,
    private readonly secondary: BookingEvidenceSource,
  ) {
    if (primary.snapshotEvidenceSource !== secondary.snapshotEvidenceSource) {
      throw new Error(
        'Las fuentes de evidencia combinadas deben pertenecer al mismo modo de datos',
      );
    }
    this.snapshotEvidenceSource = primary.snapshotEvidenceSource;
  }

  async load(reservationId: DecimalId): Promise<BookingEvidence | null> {
    return (await this.primary.load(reservationId)) ?? this.secondary.load(reservationId);
  }
}
