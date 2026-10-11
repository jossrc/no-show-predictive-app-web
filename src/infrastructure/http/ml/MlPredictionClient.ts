import type {
  MlBatchRequest,
  MlBatchResponse,
  MlCompareRequest,
  MlCompareResponse,
  MlExplanationRequest,
  MlExplanationResponse,
  MlModelsResponse,
  MlPredictionRequest,
  MlPredictionResponse,
  MlReadyResponse,
} from './MlContractTypes.js';

/** Contexto técnico de la llamada: sin secretos. La clave de servicio vive solo en el adaptador. */
export interface MlRequestContext {
  /** Identificador opaco para correlación; nunca IDs de cliente/reserva. */
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

/** Cliente del servicio interno depi-noshow-ml v1. Toda respuesta se valida en runtime. */
export interface MlPredictionClient {
  getModels(context: MlRequestContext): Promise<MlModelsResponse>;
  predict(request: MlPredictionRequest, context: MlRequestContext): Promise<MlPredictionResponse>;
  compare(request: MlCompareRequest, context: MlRequestContext): Promise<MlCompareResponse>;
  explain(request: MlExplanationRequest, context: MlRequestContext): Promise<MlExplanationResponse>;
  batch(request: MlBatchRequest, context: MlRequestContext): Promise<MlBatchResponse>;
  ready(context: MlRequestContext): Promise<MlReadyResponse>;
}
