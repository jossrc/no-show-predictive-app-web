import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

export interface RecordSpaceRecoveryOutcomeInput {
  readonly reservationId: DecimalId;
  readonly clinicScope: ClinicAccessScope;
  readonly spaceRecovered: boolean;
  readonly requestId: string;
}
