import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';
import type { NotScorableReason } from '../models/NotScorableReason.js';

/** Sin snapshot original demostrable no se «reconstruyen» factores con datos que cambiaron. */
export class ExplanationSnapshotUnavailableException extends ConflictException {
  static readonly CODE = 'EXPLANATION_SNAPSHOT_UNAVAILABLE';

  constructor(reasons: readonly NotScorableReason[]) {
    super({
      message: 'No existe instantánea original de la reserva para explicar la estimación',
      code: ExplanationSnapshotUnavailableException.CODE,
      details: { reasons },
    });
  }
}
