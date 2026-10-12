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
  MlResearchCompareResponse,
  MlResearchPolicyCatalog,
  MlResearchPredictionResponse,
} from '../../src/infrastructure/http/ml/MlContractTypes.js';
import { EXPERIMENTAL_RISK_LABELS } from '../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { bandImpliedByContract } from '../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import {
  toCanonicalFeatures,
  type PredictionFeatures,
} from '../../src/infrastructure/http/ml/MlFeatureContract.js';
import type {
  MlPredictionClient,
  MlRequestContext,
} from '../../src/infrastructure/http/ml/MlPredictionClient.js';
import { loadJsonFixture, loadMlGolden } from './LoadFixture.js';

type Operation =
  | 'models'
  | 'ready'
  | 'predict'
  | 'compare'
  | 'explain'
  | 'batch'
  | 'research_policy'
  | 'research_predict'
  | 'research_compare';

export type SyntheticBandCase =
  'synthetic-case-1' | 'synthetic-case-2' | 'synthetic-case-3' | 'synthetic-case-4';

interface BandCase {
  readonly name: SyntheticBandCase;
  readonly body: MlResearchCompareResponse;
}

/**
 * Respuesta real de Python v2 cuyo request tiene EXACTAMENTE estas 19 predictoras (4 casos de
 * bandas + examples/prediction_compare.json). null si ninguna coincide.
 */
export function bandResponseForFeatures(
  features: PredictionFeatures,
): MlResearchCompareResponse | null {
  const key = JSON.stringify(toCanonicalFeatures(features));
  const { cases } = loadJsonFixture<{
    cases: Array<{ request: { features: PredictionFeatures }; body: MlResearchCompareResponse }>;
  }>('fixtures/ml/golden_v2_band_cases.json');
  const example = loadJsonFixture<{ request: { features: PredictionFeatures } }>(
    'fixtures/ml/synthetic_compare_request.json',
  );
  const candidates = [
    ...cases.map((c) => ({ features: c.request.features, body: c.body })),
    {
      features: example.request.features,
      body: loadMlGolden<MlResearchCompareResponse>('golden_v2_compare'),
    },
  ];
  const found = candidates.find((c) => JSON.stringify(toCanonicalFeatures(c.features)) === key);
  return found ? structuredClone(found.body) : null;
}

/** Respuestas REALES de Python v2 a los 4 casos sintéticos (LOW/MEDIUM/HIGH en ambos modelos). */
export function loadBandCase(name: SyntheticBandCase): MlResearchCompareResponse {
  const { cases } = loadJsonFixture<{ cases: BandCase[] }>('fixtures/ml/golden_v2_band_cases.json');
  const found = cases.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Caso ${name} inexistente`);
  return structuredClone(found.body);
}

export interface RecordedCall {
  readonly operation: Operation;
  readonly request: unknown;
  readonly context: MlRequestContext;
}

/**
 * Doble del servicio Python con respuestas golden SINTÉTICAS ya validadas por el contrato.
 * Permite inyectar fallos por operación y registra cada llamada (para probar «sin N+1» y
 * «GET sin inferencia»).
 */
export class FakePredictionClient implements MlPredictionClient {
  readonly calls: RecordedCall[] = [];
  private readonly failures = new Map<Operation, Error>();
  private probabilityOverride: Partial<
    Record<'random_forest_full_v1' | 'xgboost_full_v1', number>
  > = {};
  /** Política research publicada por el doble: 'available' (golden real) o 'unavailable'. */
  researchPolicy: 'available' | 'unavailable' = 'available';
  /** Si se define, v2 responde con la respuesta real de Python para ese caso sintético. */
  bandCase: SyntheticBandCase | null = null;
  /**
   * Modo estricto: v2 responde con la respuesta real de Python cuyo request tiene EXACTAMENTE
   * las 19 predictoras recibidas; cualquier otra entrada falla (prueba de paridad del builder).
   */
  bandCasesByFeatures = false;

  failWith(operation: Operation, error: Error): void {
    this.failures.set(operation, error);
  }

  clearFailures(): void {
    this.failures.clear();
  }

  setProbability(modelKey: 'random_forest_full_v1' | 'xgboost_full_v1', value: number): void {
    this.probabilityOverride[modelKey] = value;
  }

  callsOf(operation: Operation): RecordedCall[] {
    return this.calls.filter((call) => call.operation === operation);
  }

  async getModels(context: MlRequestContext): Promise<MlModelsResponse> {
    return this.respond('models', null, context, () =>
      loadMlGolden<MlModelsResponse>('golden_models'),
    );
  }

  async ready(context: MlRequestContext): Promise<MlReadyResponse> {
    return this.respond('ready', null, context, () =>
      loadMlGolden<MlReadyResponse>('golden_ready'),
    );
  }

  async predict(
    request: MlPredictionRequest,
    context: MlRequestContext,
  ): Promise<MlPredictionResponse> {
    return this.respond('predict', request, context, () => {
      const golden =
        request.model_key === 'xgboost_full_v1' ? 'golden_predict_xgb' : 'golden_predict_rf';
      return this.withOverride(loadMlGolden<MlPredictionResponse>(golden), context);
    });
  }

  async compare(request: MlCompareRequest, context: MlRequestContext): Promise<MlCompareResponse> {
    return this.respond('compare', request, context, () => {
      const response = loadMlGolden<MlCompareResponse>('golden_compare');
      const [rf, xgb] = response.results;
      const results: MlCompareResponse['results'] = [
        this.withOverride(rf, context),
        this.withOverride(xgb, context),
      ];
      return {
        ...response,
        results,
        request_id: context.requestId,
        comparison: {
          ...response.comparison,
          absolute_probability_difference: Math.abs(
            results[0].probability_no_show - results[1].probability_no_show,
          ),
        },
      };
    });
  }

  async explain(
    request: MlExplanationRequest,
    context: MlRequestContext,
  ): Promise<MlExplanationResponse> {
    return this.respond('explain', request, context, () => {
      const golden =
        request.model_key === 'xgboost_full_v1' ? 'golden_explain_xgb' : 'golden_explain_rf';
      const response = loadMlGolden<MlExplanationResponse>(golden);
      const factors = response.explanation.factors.slice(0, request.top_k);
      return {
        ...response,
        request_id: context.requestId,
        explanation: { ...response.explanation, top_k: request.top_k, factors },
      };
    });
  }

  async getResearchPolicy(context: MlRequestContext): Promise<MlResearchPolicyCatalog> {
    return this.respond('research_policy', null, context, () => ({
      ...loadMlGolden<MlResearchPolicyCatalog>(
        this.researchPolicy === 'available'
          ? 'golden_v2_risk_policy'
          : 'golden_v2_risk_policy_unavailable',
      ),
      request_id: context.requestId,
    }));
  }

  async predictResearch(
    request: MlPredictionRequest,
    context: MlRequestContext,
  ): Promise<MlResearchPredictionResponse> {
    return this.respond('research_predict', request, context, () => {
      const fromCase = this.bandCase
        ? loadBandCase(this.bandCase).results.find((r) => r.model_key === request.model_key)
        : this.bandCasesByFeatures
          ? this.strictBandResponse(request.features).results.find(
              (r) => r.model_key === request.model_key,
            )
          : undefined;
      const golden =
        fromCase ??
        loadMlGolden<MlResearchPredictionResponse>(
          request.model_key === 'xgboost_full_v1'
            ? 'golden_v2_predict_xgb'
            : 'golden_v2_predict_rf',
        );
      return this.withResearchOverride(golden, context);
    });
  }

  async compareResearch(
    request: MlCompareRequest,
    context: MlRequestContext,
  ): Promise<MlResearchCompareResponse> {
    return this.respond('research_compare', request, context, () => {
      const response = this.bandCase
        ? loadBandCase(this.bandCase)
        : this.bandCasesByFeatures
          ? this.strictBandResponse(request.features)
          : loadMlGolden<MlResearchCompareResponse>('golden_v2_compare');
      const [rf, xgb] = response.results;
      const results: MlResearchCompareResponse['results'] = [
        this.withResearchOverride(rf, context),
        this.withResearchOverride(xgb, context),
      ];
      return {
        ...response,
        results,
        request_id: context.requestId,
        comparison: {
          ...response.comparison,
          absolute_probability_difference: Math.abs(
            results[0].probability_no_show - results[1].probability_no_show,
          ),
        },
      };
    });
  }

  async batch(request: MlBatchRequest, context: MlRequestContext): Promise<MlBatchResponse> {
    return this.respond('batch', request, context, () =>
      loadMlGolden<MlBatchResponse>(
        request.mode === 'compare' ? 'golden_batch_compare' : 'golden_batch_single',
      ),
    );
  }

  private withOverride(
    score: MlPredictionResponse,
    context: MlRequestContext,
  ): MlPredictionResponse {
    const override = this.probabilityOverride[score.model_key];
    return {
      ...score,
      request_id: context.requestId,
      ...(override === undefined ? {} : { probability_no_show: override }),
    };
  }

  private strictBandResponse(features: PredictionFeatures): MlResearchCompareResponse {
    const response = bandResponseForFeatures(features);
    if (!response)
      throw new Error('Predictoras sin respuesta real de Python publicada (doble estricto)');
    return response;
  }

  /**
   * Con probabilidad forzada, el DOBLE reproduce la regla publicada por Python con los límites
   * de la propia respuesta real (solo en pruebas; Node no clasifica en producción).
   */
  private withResearchOverride(
    score: MlResearchPredictionResponse,
    context: MlRequestContext,
  ): MlResearchPredictionResponse {
    const override = this.probabilityOverride[score.model_key];
    if (override === undefined) return { ...score, request_id: context.requestId };
    const level = bandImpliedByContract(override, score.experimental_risk);
    return {
      ...score,
      request_id: context.requestId,
      probability_no_show: override,
      probability_no_show_percent: override * 100,
      experimental_risk: {
        ...score.experimental_risk,
        level,
        label: EXPERIMENTAL_RISK_LABELS[level],
      },
    };
  }

  private respond<T>(
    operation: Operation,
    request: unknown,
    context: MlRequestContext,
    build: () => T,
  ): T {
    this.calls.push({ operation, request: structuredClone(request), context });
    const failure = this.failures.get(operation);
    if (failure) throw failure;
    return build();
  }
}
