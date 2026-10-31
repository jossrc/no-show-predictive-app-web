import type { MlModelDescriptor, MlModelsResponse } from './MlContractTypes.js';
import type { MlModelKey } from './MlFeatureContract.js';
import type { MlPredictionClient, MlRequestContext } from './MlPredictionClient.js';

/**
 * Catálogo de modelos con TTL corto. Permite conocer model_version vigente para decidir
 * idempotencia sin llamar a inferencia. Una sola carga concurrente (sin estampida).
 */
export class CachedMlModelCatalog {
  private cached: { value: MlModelsResponse; loadedAtMs: number } | null = null;
  private inFlight: Promise<MlModelsResponse> | null = null;

  constructor(
    private readonly client: MlPredictionClient,
    private readonly ttlMs: number,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async getModels(context: MlRequestContext): Promise<MlModelsResponse> {
    if (this.cached && this.nowMs() - this.cached.loadedAtMs < this.ttlMs) {
      return this.cached.value;
    }

    if (!this.inFlight) {
      this.inFlight = this.client
        .getModels(context)
        .then((value) => {
          this.cached = { value, loadedAtMs: this.nowMs() };
          return value;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }

    return this.inFlight;
  }

  async getModel(
    modelKey: MlModelKey,
    context: MlRequestContext,
  ): Promise<MlModelDescriptor | null> {
    const catalog = await this.getModels(context);
    return catalog.models.find((model) => model.model_key === modelKey) ?? null;
  }

  invalidate(): void {
    this.cached = null;
  }
}
