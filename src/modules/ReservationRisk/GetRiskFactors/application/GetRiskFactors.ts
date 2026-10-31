import type { MlPredictionClient } from '../../../../infrastructure/http/ml/MlPredictionClient.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../Shared/access/LoadAccessibleReservation.js';
import type { BookingSnapshotResolver } from '../../Shared/calculation/BookingSnapshotResolver.js';
import { FEATURE_LABELS, SENSITIVE_FEATURES } from '../../Shared/constants/FeatureLabels.js';
import { ExplanationSnapshotUnavailableException } from '../../Shared/errors/ExplanationSnapshotUnavailableException.js';
import { summarizeExperimentalRisk } from '../../Shared/models/ExperimentalRisk.js';
import { notScorableReason } from '../../Shared/models/NotScorableReason.js';
import type { PredictionResultRepository } from '../../Shared/persistence/PredictionResultRepository.js';
import type { GetRiskFactorsInput } from './input/GetRiskFactorsInput.js';
import type { GetRiskFactorsResult } from './result/GetRiskFactorsResult.js';

export interface GetRiskFactorsDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly resolver: BookingSnapshotResolver;
  readonly results: Pick<PredictionResultRepository, 'findLatestBySnapshot'>;
  readonly ml: Pick<MlPredictionClient, 'explain'>;
}

/**
 * HU-05: explicación SHAP local bajo demanda (al abrir el detalle) con las MISMAS 19 features
 * del snapshot original. No escribe ni reentrena; si SHAP falla, el score persistido queda
 * intacto. Factores = asociación con la salida del modelo, no causas.
 */
export class GetRiskFactors {
  constructor(private readonly deps: GetRiskFactorsDependencies) {}

  async execute(input: GetRiskFactorsInput): Promise<GetRiskFactorsResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );

    const snapshot = await this.deps.resolver.findStored(reservation);
    if (!snapshot) {
      const resolution = await this.deps.resolver.resolve(reservation);
      const reasons =
        resolution.kind === 'NOT_SCORABLE'
          ? resolution.reasons
          : [notScorableReason('NO_USABLE_SNAPSHOT_IN_MODE')];
      throw new ExplanationSnapshotUnavailableException(reasons);
    }

    const response = await this.deps.ml.explain(
      {
        feature_version: snapshot.featureVersion,
        feature_context: {
          snapshot_type: 'booking_creation',
          builder_version: snapshot.builderVersion,
        },
        features: snapshot.features,
        model_key: input.modelKey,
        top_k: input.topK,
      },
      { requestId: input.requestId },
    );

    const persisted = (await this.deps.results.findLatestBySnapshot(snapshot.snapshotId)).find(
      (score) => score.modelKey === input.modelKey,
    );
    const explanation = response.explanation;

    return {
      reservationId: reservation.reservationId,
      snapshot: {
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.snapshotHash,
        predictionAt: snapshot.predictionAt,
        featureVersion: snapshot.featureVersion,
        builderVersion: snapshot.builderVersion,
      },
      model: {
        modelKey: response.model_key,
        algorithm: response.algorithm,
        modelVersion: response.model_version,
        modelHash: response.model_hash,
        validationStatus: response.validation_status,
        calibrationStatus: response.calibration_status,
        operationalUseAllowed: false,
      },
      probabilityNoShow: response.probability_no_show,
      persistedScore: {
        available: persisted !== undefined,
        sameModelIdentity:
          persisted !== undefined &&
          persisted.modelVersion === response.model_version &&
          persisted.modelHash === response.model_hash,
        probabilityNoShow: persisted?.probabilityNoShow ?? null,
        experimentalRisk: persisted?.experimentalRisk
          ? summarizeExperimentalRisk(persisted.experimentalRisk)
          : null,
      },
      explanation: {
        method: explanation.method,
        outputSpace: explanation.output_space,
        outputLink: explanation.output_link,
        baseValue: explanation.base_value,
        modelOutputInExplanationSpace: explanation.model_output_in_explanation_space,
        reconstructedOutputInExplanationSpace:
          explanation.reconstructed_output_in_explanation_space,
        additivityError: explanation.additivity_error,
        otherFeaturesContribution: explanation.other_features_contribution,
        topK: explanation.top_k,
        totalFeatureCount: explanation.total_feature_count,
        factors: explanation.factors.map((factor) => ({
          featureName: factor.feature_name,
          label: FEATURE_LABELS[factor.feature_name],
          direction: factor.direction,
          contribution: factor.contribution,
          absoluteContribution: factor.absolute_contribution,
          sensitiveAttribute: SENSITIVE_FEATURES.has(factor.feature_name),
        })),
      },
    };
  }
}
