import type { OverbookingAuthorization } from '../../../Shared/models/OperationalRecords.js';

export interface EnableOverbookingResult {
  readonly authorization: OverbookingAuthorization;
  /** true ⇒ reintento idéntico de una marca ya existente (HTTP 200, sin INSERT nuevo). */
  readonly replayed: boolean;
}
