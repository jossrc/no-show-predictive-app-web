export interface ListAttendanceOutcomesQuery {
  from: string;
  to: string;
  clinicId?: string;
  limit: number;
  cursor?: string;
}

export interface ListAttendanceOutcomesRequest {
  Querystring: ListAttendanceOutcomesQuery;
}
