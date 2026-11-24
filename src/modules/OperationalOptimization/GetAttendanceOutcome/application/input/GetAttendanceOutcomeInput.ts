import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

export interface GetAttendanceOutcomeInput {
  readonly reservationId: DecimalId;
  readonly clinicScope: ClinicAccessScope;
}
