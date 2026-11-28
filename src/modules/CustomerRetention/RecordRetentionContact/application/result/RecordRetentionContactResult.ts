import type { RetentionContact } from '../../../Shared/models/RetentionContact.js';

export interface RecordRetentionContactResult {
  readonly contact: RetentionContact;
  /** true ⇒ reintento idéntico de un contacto existente (HTTP 200, sin INSERT nuevo). */
  readonly replayed: boolean;
}
