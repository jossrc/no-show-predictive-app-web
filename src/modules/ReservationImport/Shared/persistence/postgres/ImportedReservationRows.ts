import type { Reservation } from '../../../../Reservations/Shared/models/Reservation.js';
import type {
  ImportedReservation,
  ImportedReservationStatus,
} from '../../models/ImportedReservation.js';

/** Columnas fijas (whitelist) de ml.app_imported_reservations con alias `i`. */
export const IMPORTED_COLUMNS = `
  i.reservation_id::text AS reservation_id, i.batch_uid::text AS batch_uid, i.row_number,
  i.client_id::text AS client_id, i.clinic_id, i.appointment_at, i.appointment_end_at,
  i.booking_created_at, i.reservation_status, i.fwa_flag, i.reschedule_count,
  i.service_product_ids::text[] AS service_product_ids, i.row_hash, i.classification_cutoff_at`;

export interface ImportedRow {
  reservation_id: string;
  batch_uid: string;
  row_number: number;
  client_id: string;
  clinic_id: number;
  appointment_at: Date;
  appointment_end_at: Date | null;
  booking_created_at: Date;
  reservation_status: ImportedReservationStatus;
  fwa_flag: number | null;
  reschedule_count: number;
  service_product_ids: string[];
  row_hash: string;
  classification_cutoff_at: Date;
}

export function mapImportedRow(row: ImportedRow): ImportedReservation {
  return {
    reservationId: row.reservation_id,
    batchId: row.batch_uid,
    rowNumber: Number(row.row_number),
    clientId: row.client_id,
    clinicId: Number(row.clinic_id),
    appointmentAt: row.appointment_at,
    appointmentEndAt: row.appointment_end_at,
    bookingCreatedAt: row.booking_created_at,
    status: row.reservation_status,
    fwaFlag: row.fwa_flag === null ? null : (Number(row.fwa_flag) as 0 | -1),
    rescheduleCount: Number(row.reschedule_count),
    serviceProductIds: row.service_product_ids,
    rowHash: row.row_hash,
    classificationCutoffAt: row.classification_cutoff_at,
  };
}

/** Vista de reserva común: misma forma que la fuente principal, con su procedencia. */
export function toSourceReservation(imported: ImportedReservation): Reservation {
  return {
    reservationId: imported.reservationId,
    clientId: imported.clientId,
    clinicId: imported.clinicId,
    appointmentAt: imported.appointmentAt,
    bookingCreatedAt: imported.bookingCreatedAt,
    status: imported.status,
    sourceClassification: null,
    hasRescheduleEvent: imported.rescheduleCount > 0,
    classificationCutoffAt: imported.classificationCutoffAt,
    origin: 'IMPORT',
    importBatchId: imported.batchId,
  };
}
