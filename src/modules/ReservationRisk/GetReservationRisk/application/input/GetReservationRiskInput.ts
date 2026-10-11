import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

export interface GetReservationRiskInput {
  readonly reservationId: DecimalId;
  readonly clinicScope: ClinicAccessScope;
}
