import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

export interface GetOverbookingAuthorizationInput {
  readonly reservationId: DecimalId;
  readonly clinicScope: ClinicAccessScope;
}
