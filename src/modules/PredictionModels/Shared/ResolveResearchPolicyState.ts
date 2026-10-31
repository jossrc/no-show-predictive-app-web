import type { CachedResearchPolicyCatalog } from '../../../infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import type { MlResearchPolicyView } from '../../../infrastructure/http/ml/MlContractTypes.js';
import type { MlRequestContext } from '../../../infrastructure/http/ml/MlPredictionClient.js';
import { MlResearchPolicyUnavailableException } from '../../../infrastructure/http/ml/errors/MlResearchPolicyUnavailableException.js';

export interface ResearchPolicySettings {
  readonly enabled: boolean;
  readonly catalog: Pick<CachedResearchPolicyCatalog, 'getCatalog' | 'requirePolicies'>;
}

export interface ResearchPolicyState {
  readonly nodeResearchRiskEnabled: boolean;
  readonly available: boolean;
  readonly status: 'RESEARCH_PROVISIONAL' | 'UNAVAILABLE';
  readonly reason: string | null;
  readonly policies: readonly MlResearchPolicyView[];
}

/**
 * Estado VERDADERO de la política experimental: disponible solo si Node la habilita, Python la
 * publica y (si se configuró) su hash está en la allowlist. Nunca se presenta como aprobada.
 */
export async function resolveResearchPolicyState(
  settings: ResearchPolicySettings,
  context: MlRequestContext,
): Promise<ResearchPolicyState> {
  if (!settings.enabled) {
    return {
      nodeResearchRiskEnabled: false,
      available: false,
      status: 'UNAVAILABLE',
      reason: 'disabled_by_node_configuration',
      policies: [],
    };
  }

  const catalog = await settings.catalog.getCatalog(context);
  if (!catalog.available) {
    return {
      nodeResearchRiskEnabled: true,
      available: false,
      status: 'UNAVAILABLE',
      reason: catalog.reason,
      policies: [],
    };
  }

  try {
    await settings.catalog.requirePolicies(context);
  } catch (error) {
    if (!(error instanceof MlResearchPolicyUnavailableException)) throw error;
    return {
      nodeResearchRiskEnabled: true,
      available: false,
      status: 'UNAVAILABLE',
      reason: error.reason,
      policies: [],
    };
  }
  return {
    nodeResearchRiskEnabled: true,
    available: true,
    status: 'RESEARCH_PROVISIONAL',
    reason: null,
    policies: catalog.policies,
  };
}
