import type { SpaceRecoveryOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';

export interface GetSpaceRecoveryOutcomeResponse {
  data: {
    reservationId: string;
    recorded: boolean;
    spaceRecovered: boolean | null;
    outcome: SpaceRecoveryOutcomeBody | null;
    preventiveAction: { enabled: boolean; authorizationId: string | null };
    registrable: boolean;
    blocker: 'PREVENTIVE_ACTION_REQUIRED' | 'ALREADY_RECORDED' | null;
  };
  requestId: string;
}
