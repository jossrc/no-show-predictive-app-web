import type { SpaceRecoveryOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';

export interface RecordSpaceRecoveryOutcomeResponse {
  data: SpaceRecoveryOutcomeBody & { replayed: boolean };
  requestId: string;
}
