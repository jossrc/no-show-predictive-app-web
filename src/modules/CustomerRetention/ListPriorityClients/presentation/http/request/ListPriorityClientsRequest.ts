import type { PriorityClientFilterQuery } from '../../../../Shared/http/PriorityClientFilterQuery.js';

export interface ListPriorityClientsQuery extends PriorityClientFilterQuery {
  limit: number;
  cursor?: string;
}

export interface ListPriorityClientsRequest {
  Querystring: ListPriorityClientsQuery;
}
