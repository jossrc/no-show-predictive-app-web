import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';
import type { NotScorableReason } from '../models/NotScorableReason.js';

/** No se puede demostrar el snapshot as-of: no se llama a Python ni se inventa score. */
export class NotScorableException extends ConflictException {
  static readonly CODE = 'NOT_SCORABLE';

  constructor(readonly reasons: readonly NotScorableReason[]) {
    super({
      message: 'La reserva no es evaluable con evidencia temporal de su creación',
      code: NotScorableException.CODE,
      details: { reasons },
    });
  }
}
