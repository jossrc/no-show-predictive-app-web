import { UpstreamRateLimitedException } from '../../../../shared/errors/infrastructure/UpstreamRateLimitedException.js';

export type MlRateLimitOrigin = 'LOCAL_BACKPRESSURE' | 'ML_SERVICE';

export class MlRateLimitedException extends UpstreamRateLimitedException {
  static readonly CODE = 'ML_RATE_LIMITED';

  constructor(props: { operation: string; origin: MlRateLimitOrigin }) {
    super({
      message: 'El servicio de predicción está saturado',
      code: MlRateLimitedException.CODE,
      metadata: { operation: props.operation, origin: props.origin },
    });
  }
}
