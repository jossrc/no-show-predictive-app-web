import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** HU-08: sin habilitación HU-06 previa no se registra recuperación (cero INSERT). */
export class PreventiveActionRequiredException extends ConflictException {
  static readonly CODE = 'PREVENTIVE_ACTION_REQUIRED';

  constructor() {
    super({
      message: 'El horario no tiene una gestión preventiva (HU-06) registrada',
      code: PreventiveActionRequiredException.CODE,
    });
  }
}
