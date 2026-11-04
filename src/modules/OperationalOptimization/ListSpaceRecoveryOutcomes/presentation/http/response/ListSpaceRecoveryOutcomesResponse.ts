import type {
  SpaceRecoveryOutcomeBody,
  PeriodBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';

export interface ListSpaceRecoveryOutcomesResponse {
  data: SpaceRecoveryOutcomeBody[];
  pagination: { limit: number; nextCursor: string | null };
  period: PeriodBody;
  requestId: string;
}
