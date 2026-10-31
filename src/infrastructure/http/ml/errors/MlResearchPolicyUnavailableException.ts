import { InfrastructureException } from '../../../../shared/errors/infrastructure/InfrastructureException.js';

export type ResearchPolicyUnavailableReason =
  | 'disabled'
  | 'models_unavailable'
  | 'missing_policy'
  | 'hash_mismatch'
  | 'invalid_policy'
  | 'model_identity_mismatch'
  | 'insufficient_support'
  | 'disabled_by_node_configuration'
  | 'not_allowlisted'
  | 'unknown';

/**
 * La política research v2 (bandas experimentales LOW/MEDIUM/HIGH) no está disponible (HTTP 503).
 * Es distinto de la indisponibilidad de los modelos v1: nunca se sustituye por LOW ni por un
 * score v1 sin banda, y no degrada el circuito de inferencia.
 */
export class MlResearchPolicyUnavailableException extends InfrastructureException {
  static readonly CODE = 'RESEARCH_RISK_POLICY_NOT_READY';

  readonly reason: ResearchPolicyUnavailableReason;

  constructor(props: {
    operation: string;
    reason: ResearchPolicyUnavailableReason;
    httpStatus?: number;
  }) {
    super({
      message: 'La política de bandas experimentales no está disponible',
      code: MlResearchPolicyUnavailableException.CODE,
      metadata: {
        operation: props.operation,
        reason: props.reason,
        upstreamStatus: props.httpStatus ?? null,
      },
      details: { field: 'experimental_risk', reason: props.reason },
    });
    this.reason = props.reason;
  }
}
