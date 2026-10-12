import type { MlResearchPolicyCatalog, MlResearchPolicyView } from './MlContractTypes.js';
import type { MlModelKey } from './MlFeatureContract.js';
import type { MlPredictionClient, MlRequestContext } from './MlPredictionClient.js';
import { MlResearchPolicyUnavailableException } from './errors/MlResearchPolicyUnavailableException.js';

/** Un catálogo UNAVAILABLE se reconsulta pronto: la política puede volver sin reiniciar Node. */
const UNAVAILABLE_TTL_MS = 5_000;

export interface CachedResearchPolicyCatalogOptions {
  readonly ttlMs: number;
  /**
   * Hashes de política aceptados (ML_RESEARCH_EXPECTED_POLICY_HASHES). Vacío = se acepta la
   * política que publique Python, siempre trazada por hash. Con valores, cualquier otra ⇒ 503.
   */
  readonly expectedPolicyHashes: readonly string[];
  readonly nowMs?: () => number;
}

/**
 * Catálogo de la política research v2 con TTL corto y una sola carga concurrente. Node NO
 * deriva umbrales: solo conserva la identidad publicada para trazar y verificar cada score.
 */
export class CachedResearchPolicyCatalog {
  private cached: { value: MlResearchPolicyCatalog; loadedAtMs: number } | null = null;
  private inFlight: Promise<MlResearchPolicyCatalog> | null = null;
  private readonly nowMs: () => number;

  constructor(
    private readonly client: Pick<MlPredictionClient, 'getResearchPolicy'>,
    private readonly options: CachedResearchPolicyCatalogOptions,
  ) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  async getCatalog(context: MlRequestContext): Promise<MlResearchPolicyCatalog> {
    if (this.cached) {
      const ttl = this.cached.value.available ? this.options.ttlMs : UNAVAILABLE_TTL_MS;
      if (this.nowMs() - this.cached.loadedAtMs < ttl) return this.cached.value;
    }

    if (!this.inFlight) {
      this.inFlight = this.client
        .getResearchPolicy(context)
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

  /** Políticas vigentes por modelo; si no hay política utilizable lanza 503 tipado (fail-closed). */
  async requirePolicies(
    context: MlRequestContext,
  ): Promise<ReadonlyMap<MlModelKey, MlResearchPolicyView>> {
    const catalog = await this.getCatalog(context);
    if (!catalog.available) {
      throw new MlResearchPolicyUnavailableException({
        operation: 'research_policy',
        reason: catalog.reason ?? 'unknown',
      });
    }

    const expected = this.options.expectedPolicyHashes;
    if (
      expected.length > 0 &&
      catalog.policies.some((policy) => !expected.includes(policy.policy_hash))
    ) {
      throw new MlResearchPolicyUnavailableException({
        operation: 'research_policy',
        reason: 'not_allowlisted',
      });
    }
    return new Map(catalog.policies.map((policy) => [policy.model_key, policy]));
  }

  invalidate(): void {
    this.cached = null;
  }
}
