import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ML_MODEL_KEYS } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import { RiskAssessmentBodySchema } from '../../../../Shared/http/RiskHttpSchemas.js';

const responseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'requestId'],
  properties: {
    data: {
      ...RiskAssessmentBodySchema,
      required: [...RiskAssessmentBodySchema.required, 'run', 'featureWarnings'],
      properties: {
        ...RiskAssessmentBodySchema.properties,
        run: {
          type: 'object',
          additionalProperties: false,
          required: ['predictionRunId', 'replayed', 'requestedModelKeys', 'snapshotCreated'],
          properties: {
            predictionRunId: { type: ['string', 'null'] },
            replayed: { type: 'boolean' },
            requestedModelKeys: { type: 'array', items: { type: 'string' } },
            snapshotCreated: { type: 'boolean' },
          },
        },
        featureWarnings: { type: 'array', items: { type: 'string' } },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

export const RequestReservationPredictionSchema = {
  tags: ['Predictions'],
  summary: 'Solicitar una predicción exploratoria',
  description:
    'Acción explícita sobre un snapshot temporalmente válido de la reserva. compare consulta Random Forest y XGBoost de forma independiente; single requiere modelKey. No genera ensemble, no selecciona un ganador ni reentrena modelos. 201 crea y persiste un run; 200 reutiliza una predicción existente y run.replayed indica la reutilización. Conserva la probabilidad original sin redondear; percentageNoShow = probabilityNoShow * 100. Evaluación EXPLORATORY_NOT_VALIDATED, calibración not_operationally_validated y operationalUseAllowed=false; riskLevel=null (operativo), riskPolicyStatus=pending_validation y objetivo proxy NO_SHOW_CANDIDATE. Con ML_RESEARCH_RISK_ENABLED=true (por defecto) usa Python v2 y persiste junto al score la banda EXPERIMENTAL de cada modelo (experimentalRisk); si la política research no está disponible responde 503 RESEARCH_RISK_POLICY_NOT_READY sin guardar ni sustituir por v1 ni por LOW. La idempotencia considera snapshot, modelo, versión y política. Sin evidencia suficiente devuelve 409 NOT_SCORABLE. Cuerpo máximo: 1024 bytes. Los ejemplos de petición son sintéticos.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  body: {
    description:
      'Ejemplos sintéticos: compare sin modelKey; single con la clave de Random Forest o XGBoost.',
    examples: [
      { mode: 'compare' },
      { mode: 'single', modelKey: 'random_forest_full_v1' },
      { mode: 'single', modelKey: 'xgboost_full_v1' },
    ],
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: {
        type: 'string',
        enum: ['compare', 'single'],
        description:
          'compare solicita ambos modelos independientes; single solicita un único modelo.',
      },
      modelKey: {
        type: 'string',
        enum: [...ML_MODEL_KEYS],
        description: 'Obligatorio en single y prohibido en compare.',
      },
    },
    // single exige modelKey; compare lo prohíbe (sin fallback silencioso de modelo).
    if: { properties: { mode: { const: 'single' } } },
    then: { required: ['mode', 'modelKey'] },
    else: { not: { required: ['modelKey'] } },
  },
  response: {
    200: {
      ...responseBody,
      description: 'Predicción existente reutilizada; run.replayed indica la reutilización.',
    },
    201: {
      ...responseBody,
      description: 'Nuevo run de predicción creado y persistido.',
    },
    400: {
      ...ErrorResponseSchema,
      description: 'Solicitud inválida: REQUEST_VALIDATION_ERROR en parámetros, query o cuerpo.',
    },
    401: {
      ...ErrorResponseSchema,
      description:
        'Credencial x-api-key ausente o inválida; se comprueba antes de validar la solicitud.',
    },
    404: {
      ...ErrorResponseSchema,
      description: 'RESERVATION_NOT_FOUND: reserva inexistente o inaccesible para el consumidor.',
    },
    409: {
      ...ErrorResponseSchema,
      description:
        'NOT_SCORABLE: evidencia temporal insuficiente; FEATURE_VERSION_MISMATCH: versión de features incompatible.',
    },
    413: {
      ...ErrorResponseSchema,
      description: 'PAYLOAD_TOO_LARGE: el cuerpo supera el límite permitido.',
    },
    422: {
      ...ErrorResponseSchema,
      description: 'INVALID_FEATURES: features incompatibles con el contrato del modelo.',
    },
    429: {
      ...ErrorResponseSchema,
      description: 'ML_RATE_LIMITED: límite de concurrencia o cola de solicitudes ML alcanzado.',
    },
    502: {
      ...ErrorResponseSchema,
      description: 'ML_CONTRACT_VIOLATION: respuesta inválida del servicio ML.',
    },
    503: {
      ...ErrorResponseSchema,
      description:
        'ML_UNAVAILABLE, ML_CREDENTIAL_REJECTED, PERSISTENCE_UNAVAILABLE o RESEARCH_RISK_POLICY_NOT_READY (política experimental v2 no disponible; details.reason: disabled, models_unavailable, missing_policy, hash_mismatch, invalid_policy, model_identity_mismatch, insufficient_support, not_allowlisted).',
    },
    504: {
      ...ErrorResponseSchema,
      description: 'ML_TIMEOUT: tiempo de espera del servicio ML agotado.',
    },
  },
} as const satisfies FastifySchema;
