import type {
  OverbookingAuthorizationBody,
  PeriodBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';

export interface ListOverbookingAuthorizationsResponse {
  data: OverbookingAuthorizationBody[];
  pagination: { limit: number; nextCursor: string | null };
  period: PeriodBody;
  requestId: string;
}
