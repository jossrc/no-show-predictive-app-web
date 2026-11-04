export interface ListOverbookingAuthorizationsQuery {
  from: string;
  to: string;
  clinicId?: string;
  limit: number;
  cursor?: string;
}

export interface ListOverbookingAuthorizationsRequest {
  Querystring: ListOverbookingAuthorizationsQuery;
}
