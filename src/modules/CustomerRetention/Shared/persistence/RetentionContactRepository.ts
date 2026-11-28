import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  NewRetentionContact,
  RetentionContact,
  RetentionContactSummary,
} from '../models/RetentionContact.js';

export interface RetentionContactInsertOutcome {
  readonly record: RetentionContact;
  /** false ⇒ otra petición (concurrente o anterior) ya lo había registrado. */
  readonly created: boolean;
}

/** Contactos de retención en ml.app_retention_contacts (UNIQUE por reserva, inmutables). */
export interface RetentionContactRepository {
  findByReservation(reservationId: DecimalId): Promise<RetentionContact | null>;
  /** INSERT … ON CONFLICT DO NOTHING; ante carrera devuelve el registro ganador. */
  insertIfAbsent(contact: NewRetentionContact): Promise<RetentionContactInsertOutcome>;
  /** Contactos de un conjunto de reservas en UNA consulta (sin N+1). */
  contactsFor(
    reservationIds: readonly DecimalId[],
  ): Promise<ReadonlyMap<DecimalId, RetentionContactSummary>>;
}
