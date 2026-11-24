import type {
  PriorityClientBody,
  RetentionQueryContextBody,
} from '../../../../Shared/http/RetentionHttpMapper.js';

export interface ListPriorityClientsResponse extends RetentionQueryContextBody {
  data: PriorityClientBody[];
  pagination: { limit: number; nextCursor: string | null };
  riskPolicyStatus: string;
  predictiveStoreAvailable: boolean;
  requestId: string;
}
