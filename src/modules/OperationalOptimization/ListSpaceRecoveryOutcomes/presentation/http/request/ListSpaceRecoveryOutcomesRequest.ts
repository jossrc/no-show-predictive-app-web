export interface ListSpaceRecoveryOutcomesQuery {
  from: string;
  to: string;
  clinicId?: string;
  limit: number;
  cursor?: string;
}

export interface ListSpaceRecoveryOutcomesRequest {
  Querystring: ListSpaceRecoveryOutcomesQuery;
}
