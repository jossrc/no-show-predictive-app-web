import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';
import type { AttendanceStatus } from '../../../Shared/models/OperationalRecords.js';

export interface RecordAttendanceOutcomeInput {
  readonly reservationId: DecimalId;
  readonly clinicScope: ClinicAccessScope;
  readonly attendanceStatus: AttendanceStatus;
  readonly predictionRunId: string;
  readonly requestId: string;
}
