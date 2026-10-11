import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import type { RiskLevelPolicy } from '../../../../Shared/policy/RiskLevelPolicy.js';
import type { GetRiskFactors } from '../../../application/GetRiskFactors.js';
import type { GetRiskFactorsRequest } from '../request/GetRiskFactorsRequest.js';
import type { GetRiskFactorsResponse } from '../response/GetRiskFactorsResponse.js';

const UNITS = {
  probability:
    'Contribuciones en puntos de probabilidad (escala 0–1) de la clase NO_SHOW_CANDIDATE.',
  log_odds:
    'Contribuciones en log-odds (margen del modelo; enlace sigmoide). NO son puntos porcentuales.',
} as const;

export class GetRiskFactorsHandler {
  constructor(
    private readonly getRiskFactors: GetRiskFactors,
    private readonly policy: Pick<RiskLevelPolicy, 'status'>,
  ) {}

  readonly handle = async (
    request: FastifyRequest<GetRiskFactorsRequest>,
  ): Promise<GetRiskFactorsResponse> => {
    const result = await this.getRiskFactors.execute({
      reservationId: request.params.reservationId,
      modelKey: request.query.modelKey,
      topK: request.query.topK,
      requestId: request.id,
      clinicScope: requirePrincipal(request).clinicScope,
    });
    const explanation = result.explanation;

    return {
      data: {
        reservationId: result.reservationId,
        snapshot: {
          predictionAt: result.snapshot.predictionAt.toISOString(),
          featureVersion: result.snapshot.featureVersion,
          builderVersion: result.snapshot.builderVersion,
          snapshotHash: result.snapshot.snapshotHash.slice(0, 16),
        },
        model: result.model,
        probabilityNoShow: result.probabilityNoShow,
        percentageNoShow: result.probabilityNoShow * 100,
        persistedScore: result.persistedScore,
        explanation: {
          ...explanation,
          units: UNITS[explanation.outputSpace],
          factors: [...explanation.factors],
        },
        interpretation: {
          scope: 'local_association_not_causality',
          note: 'Factores asociados a esta estimación del modelo; no son causas de la inasistencia ni recomendaciones de acción.',
          unitsNote:
            'Las escalas de Random Forest (probabilidad) y XGBoost (log-odds) no son comparables directamente.',
          sensitiveAttributesNote:
            'Edad y sexo pueden aparecer como factores asociados; no deben motivar trato diferenciado ni intervenciones automáticas.',
        },
        riskLevel: null,
        riskPolicyStatus: this.policy.status,
      },
      requestId: request.id,
    };
  };
}
