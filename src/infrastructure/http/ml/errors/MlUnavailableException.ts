import { InfrastructureException } from '../../../../shared/errors/infrastructure/InfrastructureException.js';

export type MlUnavailableCode =
  | 'ML_UNAVAILABLE'
  | 'ML_NOT_CONFIGURED'
  | 'ML_CREDENTIAL_REJECTED'
  | 'ML_MODEL_UNAVAILABLE'
  | 'ML_INFERENCE_FAILED'
  | 'ML_CIRCUIT_OPEN';

/** El servicio ML no puede producir un score ahora. Nunca se convierte en probabilidad 0. */
export class MlUnavailableException extends InfrastructureException {
  constructor(props: {
    code: MlUnavailableCode;
    operation: string;
    httpStatus?: number;
    cause?: unknown;
  }) {
    super({
      message: 'El servicio de predicción no está disponible',
      code: props.code,
      metadata: { operation: props.operation, upstreamStatus: props.httpStatus ?? null },
      cause: props.cause,
    });
  }
}
