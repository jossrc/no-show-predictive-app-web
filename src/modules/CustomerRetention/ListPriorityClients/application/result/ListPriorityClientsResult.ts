import type {
  PriorityClient,
  ResolvedPriorityClientQuery,
} from '../../../Shared/query/PriorityClientQuery.js';

export interface ListPriorityClientsResult {
  readonly query: ResolvedPriorityClientQuery;
  readonly items: readonly PriorityClient[];
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly predictiveStoreAvailable: boolean;
}
