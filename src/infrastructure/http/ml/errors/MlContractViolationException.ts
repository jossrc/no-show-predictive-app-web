import { UpstreamContractException } from '../../../../shared/errors/infrastructure/UpstreamContractException.js';

export type MlContractViolationCode =
  'ML_CONTRACT_VIOLATION' | 'ML_REQUEST_REJECTED' | 'ML_PAYLOAD_TOO_LARGE';

/**
 * Respuesta Python fuera del contrato versionado (200 malformado, tipos, rangos, orden de
 * modelos, estados operativos inesperados) o petición rechazada por formato. Solo se registran
 * rutas de campo, nunca valores.
 */
export class MlContractViolationException extends UpstreamContractException {
  readonly issuePaths: readonly string[];

  constructor(props: {
    operation: string;
    code?: MlContractViolationCode;
    issuePaths?: readonly string[];
    httpStatus?: number;
  }) {
    const issuePaths = (props.issuePaths ?? []).slice(0, 20);
    super({
      message: 'El servicio de predicción respondió fuera de contrato',
      code: props.code ?? 'ML_CONTRACT_VIOLATION',
      metadata: {
        operation: props.operation,
        issuePaths,
        upstreamStatus: props.httpStatus ?? null,
      },
    });
    this.issuePaths = issuePaths;
  }
}
