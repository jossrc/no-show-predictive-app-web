import { MlUnavailableException } from './errors/MlUnavailableException.js';
import type { MlPredictionClient } from './MlPredictionClient.js';

function notConfigured(operation: string): Promise<never> {
  return Promise.reject(new MlUnavailableException({ code: 'ML_NOT_CONFIGURED', operation }));
}

/** Se usa cuando ML_SERVICE_KEY no está configurada: el listado sigue funcionando sin scores. */
export class UnconfiguredMlPredictionClient implements MlPredictionClient {
  getModels = () => notConfigured('models');
  predict = () => notConfigured('predict');
  compare = () => notConfigured('compare');
  explain = () => notConfigured('explain');
  batch = () => notConfigured('batch');
  ready = () => notConfigured('ready');
}
