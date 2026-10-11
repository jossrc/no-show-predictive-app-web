import type { RiskAssessment } from '../calculation/AssembleRiskAssessment.js';
import type { NotScorableReason } from '../models/NotScorableReason.js';
import type { RiskLevel, RiskPolicyStatus } from '../policy/RiskLevelPolicy.js';

export interface ModelResultBody {
  modelKey: string;
  algorithm: 'random_forest' | 'xgboost';
  modelVersion: string;
  modelHash: string;
  probabilityNoShow: number;
  percentageNoShow: number;
  target: 'NO_SHOW_CANDIDATE';
  validationStatus: string;
  calibrationStatus: string;
  operationalUseAllowed: false;
  riskLevel: RiskLevel | null;
  predictionAt: string;
  scoredAt: string;
  predictionRunId: string;
}

export interface RiskAssessmentBody {
  reservationId: string;
  status: RiskAssessment['status'];
  reasons: NotScorableReason[];
  sourceStatus: RiskAssessment['sourceStatus'];
  sourceFreshness?: 'CURRENT' | 'STALE_CLASSIFICATION';
  snapshot: {
    snapshotType: 'booking_creation';
    predictionAt: string;
    appointmentAt: string;
    featureVersion: string;
    builderVersion: string;
    evidenceSource: 'VERIFIED_BOOKING_SNAPSHOT' | 'SYNTHETIC_DEMO_ONLY';
    snapshotHash: string;
  } | null;
  models: ModelResultBody[];
  comparison: {
    absoluteProbabilityDifference: number;
    absolutePercentagePointDifference: number;
    interpretation: 'descriptive_only_not_model_confidence';
    ensembleProbability: null;
    selectedWinner: null;
  } | null;
  /** Nivel global: siempre null (sin ensemble ni política aprobada en Sprint 01). */
  riskLevel: RiskLevel | null;
  riskPolicyStatus: RiskPolicyStatus;
  riskPolicyVersion: string | null;
  classificationUnavailable: boolean;
  validationStatus: 'EXPLORATORY_NOT_VALIDATED';
  operationalUseAllowed: false;
  message: string;
}

const MESSAGES: Readonly<Record<RiskAssessment['status'], string>> = {
  AVAILABLE_EXPLORATORY:
    'Estimación experimental no calibrada (EXPLORATORY_NOT_VALIDATED). Niveles de riesgo pendientes de validación; no usar para decisiones operativas.',
  NOT_SCORED:
    'Existe evidencia válida de la reserva pero aún no se solicitó la predicción (acción explícita POST .../predictions).',
  NOT_SCORABLE:
    'No es posible estimar sin evidencia temporal de la creación de la reserva; no se genera un score sustituto.',
};

export function toRiskAssessmentBody(assessment: RiskAssessment): RiskAssessmentBody {
  const snapshot = assessment.snapshot;
  const anyClassified = assessment.models.some((model) => model.policyRiskLevel !== null);

  return {
    reservationId: assessment.reservationId,
    status: assessment.status,
    reasons: [...assessment.reasons],
    sourceStatus: assessment.sourceStatus,
    snapshot: snapshot
      ? {
          snapshotType: snapshot.snapshotType,
          predictionAt: snapshot.predictionAt.toISOString(),
          appointmentAt: snapshot.appointmentAt.toISOString(),
          featureVersion: snapshot.featureVersion,
          builderVersion: snapshot.builderVersion,
          evidenceSource: snapshot.evidenceSource,
          // Identidad interna abreviada: suficiente para correlacionar sin exponer el payload.
          snapshotHash: snapshot.snapshotHash.slice(0, 16),
        }
      : null,
    models: assessment.models.map((model) => ({
      modelKey: model.modelKey,
      algorithm: model.algorithm,
      modelVersion: model.modelVersion,
      modelHash: model.modelHash,
      probabilityNoShow: model.probabilityNoShow,
      percentageNoShow: model.probabilityNoShow * 100,
      target: model.predictionTarget,
      validationStatus: model.validationStatus,
      calibrationStatus: model.calibrationStatus,
      operationalUseAllowed: false,
      riskLevel: model.policyRiskLevel,
      predictionAt: model.predictionAt.toISOString(),
      scoredAt: model.scoredAt.toISOString(),
      predictionRunId: model.predictionRunId,
    })),
    comparison: assessment.comparison
      ? {
          absoluteProbabilityDifference: assessment.comparison.absoluteProbabilityDifference,
          absolutePercentagePointDifference:
            assessment.comparison.absoluteProbabilityDifference * 100,
          interpretation: 'descriptive_only_not_model_confidence',
          ensembleProbability: null,
          selectedWinner: null,
        }
      : null,
    riskLevel: null,
    riskPolicyStatus: assessment.riskPolicyStatus,
    riskPolicyVersion: assessment.riskPolicyVersion,
    classificationUnavailable: !anyClassified,
    validationStatus: 'EXPLORATORY_NOT_VALIDATED',
    operationalUseAllowed: false,
    message: MESSAGES[assessment.status],
  };
}
