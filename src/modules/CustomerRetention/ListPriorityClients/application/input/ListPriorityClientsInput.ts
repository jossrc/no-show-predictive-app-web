import type { PriorityClientFilters } from '../../../Shared/query/PriorityClientQuery.js';

export interface ListPriorityClientsInput {
  readonly filters: PriorityClientFilters;
  readonly limit: number;
  readonly cursor: string | null;
}
