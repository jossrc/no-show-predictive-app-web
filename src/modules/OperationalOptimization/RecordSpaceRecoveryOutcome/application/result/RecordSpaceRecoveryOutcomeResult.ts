import type { SpaceRecoveryOutcome } from '../../../Shared/models/OperationalRecords.js';

export interface RecordSpaceRecoveryOutcomeResult {
  readonly outcome: SpaceRecoveryOutcome;
  /** true ⇒ reintento idéntico (HTTP 200, sin INSERT nuevo). */
  readonly replayed: boolean;
}
