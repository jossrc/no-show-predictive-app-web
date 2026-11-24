import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** HU-08: ya existe otro resultado de recuperación; no se reescribe. */
export class SpaceRecoveryAlreadyRecordedConflictException extends ConflictException {
  static readonly CODE = 'SPACE_RECOVERY_ALREADY_RECORDED_CONFLICT';

  constructor(existing: { spaceRecovered: boolean }) {
    super({
      message: 'La recuperación del espacio ya fue registrada con otro valor; no se modifica',
      code: SpaceRecoveryAlreadyRecordedConflictException.CODE,
      details: { ...existing },
    });
  }
}
