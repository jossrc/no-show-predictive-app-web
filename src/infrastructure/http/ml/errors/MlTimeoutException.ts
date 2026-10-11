import { UpstreamTimeoutException } from '../../../../shared/errors/infrastructure/UpstreamTimeoutException.js';

/** El presupuesto de tiempo expiró. El cómputo Python puede seguir en curso: no se reintenta. */
export class MlTimeoutException extends UpstreamTimeoutException {
  static readonly CODE = 'ML_TIMEOUT';

  constructor(props: { operation: string; timeoutMs: number; cause?: unknown }) {
    super({
      message: 'El servicio de predicción excedió el tiempo permitido',
      code: MlTimeoutException.CODE,
      metadata: { operation: props.operation, timeoutMs: props.timeoutMs },
      cause: props.cause,
    });
  }
}
