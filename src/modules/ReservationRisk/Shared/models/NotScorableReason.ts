/** Motivos tipados y seguros (sin datos personales) por los que no se genera un score. */
export const NOT_SCORABLE_REASON_MESSAGES = {
  RESERVATION_NOT_SCHEDULED: 'La reserva no está programada (cancelada, pasada o excluida)',
  MISSING_BOOKING_TIME: 'La fuente no registra el instante de creación de la reserva',
  BOOKING_NOT_BEFORE_APPOINTMENT: 'La creación de la reserva no es anterior a la cita',
  LEAD_TIME_OUT_OF_TRAINING_RANGE:
    'La anticipación supera 730 días, fuera de la población de entrenamiento',
  RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT:
    'La cita fue reprogramada y no existe instantánea original de la reserva',
  SCHEDULED_SERVICES_NOT_POINT_IN_TIME:
    'Los servicios programados provienen de la réplica actual sin evidencia temporal de la reserva',
  CATALOG_NOT_POINT_IN_TIME:
    'El catálogo de servicios cambió (o no es verificable) después de la reserva',
  CLIENT_ATTRIBUTES_NOT_POINT_IN_TIME:
    'Los atributos del cliente cambiaron (o no son verificables) después de la reserva',
  CLIENT_NOT_FOUND: 'El cliente de la reserva no existe en la fuente',
  HISTORY_NOT_AS_OF: 'El historial recibido no respeta el corte known_at < prediction_at',
  INVALID_SOURCE_VALUE: 'La fuente contiene un valor incoherente para construir las predictoras',
  NO_USABLE_SNAPSHOT_IN_MODE:
    'No existe instantánea de reserva utilizable en el modo de datos activo',
} as const;

export type NotScorableReasonCode = keyof typeof NOT_SCORABLE_REASON_MESSAGES;

export interface NotScorableReason {
  readonly code: NotScorableReasonCode;
  readonly message: string;
}

export function notScorableReason(code: NotScorableReasonCode): NotScorableReason {
  return { code, message: NOT_SCORABLE_REASON_MESSAGES[code] };
}
