export interface ImportRowErrorBody {
  code: string;
  field: string | null;
  message: string;
}

export interface ImportReservationsBody {
  batchId: string;
  contractVersion: string;
  fileFormat: 'CSV' | 'XLSX';
  fileSha256: string;
  fileSizeBytes: number;
  status: 'COMPLETED' | 'COMPLETED_WITH_REJECTIONS' | 'NO_ROWS_ACCEPTED';
  statusLabel: string;
  processedAt: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  acceptedReservations: Array<{ rowNumber: number; reservationId: string }>;
  rejectedRowDetails: Array<{
    rowNumber: number;
    reservationId: string | null;
    errors: ImportRowErrorBody[];
  }>;
  rejectionSummary: Array<{ code: string; message: string; rows: number }>;
  ignoredColumns: string[];
  predictionsGenerated: false;
  notice: string;
  actorKind: 'INTERNAL_SERVICE';
  actorUserId: null;
}

export interface ImportReservationsResponse {
  data: ImportReservationsBody;
  requestId: string;
}
