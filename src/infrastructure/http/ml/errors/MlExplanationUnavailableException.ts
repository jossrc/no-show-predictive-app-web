import { InfrastructureException } from '../../../../shared/errors/infrastructure/InfrastructureException.js';

/** SHAP opcional no disponible. No invalida ni borra scores previos. */
export class MlExplanationUnavailableException extends InfrastructureException {
  static readonly CODE = 'EXPLANATION_UNAVAILABLE';

  constructor(props: { upstreamCode: string; httpStatus: number }) {
    super({
      message: 'La explicación local no está disponible',
      code: MlExplanationUnavailableException.CODE,
      metadata: { upstreamCode: props.upstreamCode, upstreamStatus: props.httpStatus },
    });
  }
}
