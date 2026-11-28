/**
 * Contrato de importación `reservation_import_v1`. No es el formato oficial de exportación del
 * sistema de agendamiento: es un contrato EXPLÍCITO de esta API construido con los campos
 * verificados de FLOWww (`raw_flow.diary_gen`, `raw_flow.diary_det`) y con
 * `cantidad_reprogramaciones` de la consulta operacional documentada (copias con
 * `DiaryGDelayedID` = `DiaryGID`). Una fila = una reserva; los servicios previstos
 * (`diary_det.DiaryZoneID`) van en una sola celda separados por `|`.
 * Fechas y horas: hora de pared de America/Lima (igual que FLOWww); se persisten en UTC.
 */
export const RESERVATION_IMPORT_CONTRACT_VERSION = 'reservation_import_v1';

export const IMPORT_COLUMNS = {
  reservationId: 'DiaryGID',
  clientId: 'DiaryGClientID',
  clinicId: 'DiaryGClinicID',
  appointmentDate: 'DiaryGDate',
  appointmentStart: 'DiaryGStart',
  appointmentEnd: 'DiaryGEnd',
  bookingCreatedAt: 'DiaryGCreated',
  notAttendedFlag: 'DiaryGNotAttended',
  fwaFlag: 'DiaryGFWA',
  serviceProductIds: 'DiaryZoneIDs',
  rescheduleCount: 'cantidad_reprogramaciones',
  delayedFlag: 'DiaryGDelayed',
  lockedFlag: 'DiaryGLocked',
  tags: 'DiaryGTags',
} as const;

export type ImportField = keyof typeof IMPORT_COLUMNS;
export type ImportColumnName = (typeof IMPORT_COLUMNS)[ImportField];

export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = [
  'reservationId',
  'clientId',
  'clinicId',
  'appointmentDate',
  'appointmentStart',
  'bookingCreatedAt',
  'notAttendedFlag',
  'serviceProductIds',
  'rescheduleCount',
];

/** Opcionales: si faltan se aplica el tratamiento existente (null), nunca un valor inventado. */
export const OPTIONAL_IMPORT_FIELDS: readonly ImportField[] = [
  'appointmentEnd',
  'fwaFlag',
  'delayedFlag',
  'lockedFlag',
  'tags',
];

export const SERVICE_LIST_SEPARATOR = '|';
export const MAX_SERVICE_LINES = 50;
export const MAX_RESCHEDULE_COUNT = 1000;

/** Motivos de rechazo por FILA (códigos estables; el valor recibido nunca se devuelve). */
export const ROW_REJECTION_MESSAGES = {
  REQUIRED_VALUE_MISSING: 'Falta un valor obligatorio',
  INVALID_IDENTIFIER:
    'Identificador inválido: entero positivo de hasta 18 dígitos sin ceros a la izquierda (guárdelo como texto en Excel)',
  INVALID_CLINIC_ID: 'Sede inválida: entero positivo de hasta 9 dígitos',
  INVALID_DATE: 'Fecha inválida: use YYYY-MM-DD o DD/MM/YYYY',
  INVALID_TIME: 'Hora inválida: use HH:MM o HH:MM:SS (24 horas)',
  INVALID_DATETIME:
    'Fecha y hora inválidas: use YYYY-MM-DD HH:MM[:SS] o DD/MM/YYYY HH:MM[:SS] (hora de Lima, sin zona)',
  INVALID_FLAG: 'Indicador inválido: se admite 0 o -1',
  INVALID_RESCHEDULE_COUNT: `Cantidad de reprogramaciones inválida: entero entre 0 y ${MAX_RESCHEDULE_COUNT}`,
  INVALID_SERVICE_LIST: `Servicios inválidos: IDs de producto separados por "${SERVICE_LIST_SEPARATOR}", entre 1 y ${MAX_SERVICE_LINES}`,
  INVALID_COLUMN_COUNT: 'La fila tiene más columnas que la cabecera',
  END_BEFORE_START: 'La hora de término es anterior a la hora de inicio',
  BOOKING_NOT_BEFORE_APPOINTMENT: 'La creación de la reserva no es anterior a la cita',
  BOOKING_CREATED_IN_FUTURE: 'La creación de la reserva es posterior al momento de procesamiento',
  APPOINTMENT_NOT_FUTURE: 'La cita no es futura respecto del momento de procesamiento',
  NOT_A_RESERVATION:
    'La fila es una copia histórica, un bloqueo o un borrador del agendamiento; no es una reserva',
  DUPLICATE_ROW_IN_FILE:
    'La reserva ya aparece en una fila anterior del archivo con los mismos datos',
  CONFLICTING_DUPLICATE_IN_FILE:
    'La reserva aparece varias veces en el archivo con datos distintos',
  RESERVATION_EXISTS_IN_SOURCE: 'La reserva ya existe en el sistema de agendamiento de origen',
  ALREADY_IMPORTED: 'La reserva ya fue incorporada en un lote anterior con los mismos datos',
  ALREADY_IMPORTED_WITH_DIFFERENT_DATA:
    'La reserva ya fue incorporada con datos distintos; el registro original no se modifica',
  UNKNOWN_CLINIC: 'La sede no existe',
  CLINIC_OUT_OF_SCOPE: 'La sede está fuera del alcance autorizado',
  CLIENT_NOT_FOUND: 'El cliente no existe en el sistema de agendamiento de origen',
  PRODUCT_NOT_FOUND: 'Uno o más servicios no existen en el catálogo de productos',
} as const;

export type RowRejectionCode = keyof typeof ROW_REJECTION_MESSAGES;

/** Errores generales del ARCHIVO (el lote no se procesa ni se registra). */
export const FILE_ERROR_MESSAGES = {
  IMPORT_FILE_REQUIRED: 'Adjunte un archivo en el campo "file" (multipart/form-data)',
  UNSUPPORTED_FILE_FORMAT: 'Formato no admitido: solo CSV (.csv) o Excel (.xlsx)',
  FILE_CONTENT_MISMATCH: 'El contenido del archivo no corresponde a su extensión',
  EMPTY_FILE: 'El archivo está vacío',
  INVALID_FILE_ENCODING: 'El archivo CSV debe estar codificado en UTF-8',
  INVALID_FILE_STRUCTURE: 'La estructura del archivo no es válida',
  SPREADSHEET_MACROS_NOT_ALLOWED: 'El libro contiene macros; no se procesa',
  SPREADSHEET_FORMULAS_NOT_ALLOWED: 'La hoja contiene fórmulas; exporte los valores sin fórmulas',
  SPREADSHEET_EXTERNAL_CONTENT_NOT_ALLOWED:
    'El libro contiene vínculos o conexiones externas; no se procesa',
  MISSING_REQUIRED_COLUMNS: 'Faltan columnas obligatorias del contrato de importación',
  DUPLICATE_COLUMNS: 'La cabecera contiene columnas repetidas',
  NO_DATA_ROWS: 'El archivo no contiene filas de datos',
  TOO_MANY_ROWS: 'El archivo supera la cantidad máxima de filas por lote',
} as const;

export type ImportFileErrorCode = keyof typeof FILE_ERROR_MESSAGES;
