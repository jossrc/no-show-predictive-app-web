import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { OverbookingAuthorization } from '../../../Shared/models/OperationalRecords.js';
import type { OverbookingEligibility } from '../../../Shared/rules/OverbookingEligibility.js';

export interface GetOverbookingAuthorizationResult {
  readonly reservationId: DecimalId;
  /** null ⇒ NOT_ENABLED (estado explícito, no ausencia de campos). */
  readonly authorization: OverbookingAuthorization | null;
  readonly eligibility: OverbookingEligibility;
}
