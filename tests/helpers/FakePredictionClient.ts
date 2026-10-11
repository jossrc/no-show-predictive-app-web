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
} from '../../src/infrastructure/http/ml/MlContractTypes.js';
import type {
  MlPredictionClient,
  MlRequestContext,
} from '../../src/infrastructure/http/ml/MlPredictionClient.js';
import { loadMlGolden } from './LoadFixture.js';

type Operation = 'models' | 'ready' | 'predict' | 'compare' | 'explain' | 'batch';

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
