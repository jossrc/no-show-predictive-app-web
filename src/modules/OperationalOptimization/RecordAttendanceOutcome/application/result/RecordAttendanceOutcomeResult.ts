import type { AttendanceOutcome } from '../../../Shared/models/OperationalRecords.js';

export interface RecordAttendanceOutcomeResult {
  readonly outcome: AttendanceOutcome;
  /** true ⇒ reintento idéntico (HTTP 200, sin INSERT nuevo). */
  readonly replayed: boolean;
}
