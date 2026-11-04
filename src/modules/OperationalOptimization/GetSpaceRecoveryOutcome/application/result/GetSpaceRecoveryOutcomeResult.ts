import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type {
  OverbookingAuthorization,
  SpaceRecoveryOutcome,
} from '../../../Shared/models/OperationalRecords.js';

export interface GetSpaceRecoveryOutcomeResult {
  readonly reservationId: DecimalId;
  /** Gestión preventiva HU-06 previa (requisito para registrar). */
  readonly authorization: OverbookingAuthorization | null;
  /** null ⇒ sin registro (distinto de spaceRecovered=false). */
  readonly outcome: SpaceRecoveryOutcome | null;
}
