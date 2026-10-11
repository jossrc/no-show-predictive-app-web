import { InfrastructureException } from '../../../shared/errors/infrastructure/InfrastructureException.js';

/** Fallo leyendo las fuentes de solo lectura raw_flow/analytics. Sin datos inventados. */
export class SourceDataUnavailableException extends InfrastructureException {
  static readonly CODE = 'SOURCE_DATA_UNAVAILABLE';

  constructor(props: { operation: string; cause?: unknown }) {
    super({
      message: 'La fuente de datos de reservas no está disponible',
      code: SourceDataUnavailableException.CODE,
      metadata: { operation: props.operation },
      cause: props.cause,
    });
  }
}
