import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  NewSpaceRecoveryOutcome,
  SpaceRecoveryOutcome,
} from '../models/OperationalRecords.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from './OperationalRecordListCriteria.js';

/** HU-08: un resultado por autorización HU-06 (FK física); inmutable. */
export interface SpaceRecoveryOutcomeRepository {
  findByReservation(reservationId: DecimalId): Promise<SpaceRecoveryOutcome | null>;
  insertIfAbsent(outcome: NewSpaceRecoveryOutcome): Promise<InsertOutcome<SpaceRecoveryOutcome>>;
  list(
    criteria: OperationalRecordListCriteria,
  ): Promise<OperationalRecordPage<SpaceRecoveryOutcome>>;
}
