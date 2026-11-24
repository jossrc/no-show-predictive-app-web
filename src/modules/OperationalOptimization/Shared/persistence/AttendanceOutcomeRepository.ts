import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { AttendanceOutcome, NewAttendanceOutcome } from '../models/OperationalRecords.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from './OperationalRecordListCriteria.js';

/** HU-07: observación + comparaciones por modelo en UNA transacción; inmutables. */
export interface AttendanceOutcomeRepository {
  findByReservation(reservationId: DecimalId): Promise<AttendanceOutcome | null>;
  insertIfAbsent(outcome: NewAttendanceOutcome): Promise<InsertOutcome<AttendanceOutcome>>;
  list(criteria: OperationalRecordListCriteria): Promise<OperationalRecordPage<AttendanceOutcome>>;
}
