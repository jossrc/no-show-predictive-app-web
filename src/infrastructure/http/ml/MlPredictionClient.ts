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
  MlResearchCompareRequest,
  MlResearchCompareResponse,
  MlResearchPolicyCatalog,
  MlResearchPredictionRequest,
  MlResearchPredictionResponse,
} from './MlContractTypes.js';

/** Contexto técnico de la llamada: sin secretos. La clave de servicio vive solo en el adaptador. */
export interface MlRequestContext {
  /** Identificador opaco para correlación; nunca IDs de cliente/reserva. */
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

/**
 * Cliente del servicio interno depi-noshow-ml. v1 (inferencia, compare, SHAP, batch) y v2
 * research (catálogo de política y scores con `experimental_risk`) coexisten; v2 no tiene
 * explain ni batch. Toda respuesta se valida en runtime contra el contrato versionado.
 */
export interface MlPredictionClient {
  getModels(context: MlRequestContext): Promise<MlModelsResponse>;
  predict(request: MlPredictionRequest, context: MlRequestContext): Promise<MlPredictionResponse>;
  compare(request: MlCompareRequest, context: MlRequestContext): Promise<MlCompareResponse>;
  explain(request: MlExplanationRequest, context: MlRequestContext): Promise<MlExplanationResponse>;
  batch(request: MlBatchRequest, context: MlRequestContext): Promise<MlBatchResponse>;
  ready(context: MlRequestContext): Promise<MlReadyResponse>;
  /** GET /internal/v2/risk-policy: 200 también cuando la política está UNAVAILABLE. */
  getResearchPolicy(context: MlRequestContext): Promise<MlResearchPolicyCatalog>;
  /** POST /internal/v2/predictions: score crudo v1 + banda relativa del modelo pedido. */
  predictResearch(
    request: MlResearchPredictionRequest,
    context: MlRequestContext,
  ): Promise<MlResearchPredictionResponse>;
  /** POST /internal/v2/predictions/compare: RF y XGB, cada uno con su propia política. */
  compareResearch(
    request: MlResearchCompareRequest,
    context: MlRequestContext,
  ): Promise<MlResearchCompareResponse>;
}
