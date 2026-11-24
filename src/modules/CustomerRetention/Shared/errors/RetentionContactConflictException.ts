import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** Ya existe un contacto para la reserva con OTRA predicción: el registro original no cambia. */
export class RetentionContactConflictException extends ConflictException {
  static readonly CODE = 'RETENTION_CONTACT_ALREADY_RECORDED';

  constructor(existing: {
    contactId: string;
    contactedAt: string;
    modelKey: string;
    predictionRunId: string;
  }) {
    super({
      message: 'La acción de retención de esta reserva ya fue registrada con otra predicción',
      code: RetentionContactConflictException.CODE,
      details: { ...existing },
    });
  }
}
