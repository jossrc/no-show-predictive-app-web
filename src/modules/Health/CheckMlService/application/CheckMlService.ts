import type { MlPredictionClient } from '../../../../infrastructure/http/ml/MlPredictionClient.js';
import type { CheckMlServiceResult } from './result/CheckMlServiceResult.js';

/**
 * Disponibilidad acotada del servicio Python (/health/ready). Mensajes estáticos: no expone
 * claves, rutas de modelos ni detalles internos del error.
 */
export class CheckMlService {
  constructor(
    private readonly ml: Pick<MlPredictionClient, 'ready'>,
    private readonly configured: boolean,
  ) {}

  async execute(input: { requestId: string }): Promise<CheckMlServiceResult> {
    if (!this.configured) {
      return {
        service: 'ml',
        status: 'disabled',
        message: 'Servicio de predicción no configurado',
        servingStatus: null,
        operationalUseAllowed: false,
      };
    }

    try {
      const ready = await this.ml.ready({ requestId: input.requestId });
      return {
        service: 'ml',
        status: 'ok',
        message: 'Servicio de predicción disponible (exploratorio, no validado)',
        servingStatus: ready.serving_status,
        operationalUseAllowed: false,
      };
    } catch {
      return {
        service: 'ml',
        status: 'error',
        message: 'Servicio de predicción no disponible',
        servingStatus: null,
        operationalUseAllowed: false,
      };
    }
  }
}
