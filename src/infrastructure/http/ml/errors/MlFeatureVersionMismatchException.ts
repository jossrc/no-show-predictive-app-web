import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** Python rechazó la versión de features (409). No se repara fabricando features. */
export class MlFeatureVersionMismatchException extends ConflictException {
  static readonly CODE = 'FEATURE_VERSION_MISMATCH';

  constructor(props: { operation: string }) {
    super({
      message: 'La versión de features no es compatible con el servicio de predicción',
      code: MlFeatureVersionMismatchException.CODE,
      metadata: { operation: props.operation },
    });
  }
}
