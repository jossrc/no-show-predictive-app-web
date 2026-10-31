import type { RiskAssessment } from '../calculation/AssembleRiskAssessment.js';
import type { ExperimentalRisk } from '../models/ExperimentalRisk.js';
import type { NotScorableReason } from '../models/NotScorableReason.js';
import type { RiskLevel, RiskPolicyStatus } from '../policy/RiskLevelPolicy.js';

/** Aviso visible obligatorio junto a cualquier banda experimental. */
export const EXPERIMENTAL_RISK_NOTICE =
  'Banda EXPERIMENTAL (Bajo/Medio/Alto exploratorio): terciles relativos del score crudo según la política research_risk_v1_1 de Python. No es probabilidad de inasistencia, riesgo clínico ni operativo; no autoriza acciones automáticas (operationalUseAllowed=false).';

export interface ExperimentalRiskBody {
  level: ExperimentalRisk['level'];
  label: ExperimentalRisk['label'];
  status: 'RESEARCH_PROVISIONAL';
  classificationBasis: 'RESEARCH_PROVISIONAL';
  policyId: string;
  policyVersion: string;
  policyHash: string;
  lowUpperThreshold: number;
  highLowerThreshold: number;
  boundaryRule: string;
  meaning: 'relative_score_band_not_validated_absolute_risk';
  scoreSpace: 'raw_probability_no_show';
  warnings: string[];
  approvedBy: null;
  operationalUseAllowed: false;
}

export interface ModelResultBody {
  modelKey: string;
  algorithm: 'random_forest' | 'xgboost';
  modelVersion: string;
  modelHash: string;
  modelHashSha256: string | null;
  scoringApiVersion: 'v1' | 'v2';
  probabilityNoShow: number;
  percentageNoShow: number;
  target: 'NO_SHOW_CANDIDATE';
  validationStatus: string;
  calibrationStatus: string;
  operationalUseAllowed: false;
  /** Nivel OPERATIVO por política aprobada: null mientras esté pendiente. */
  riskLevel: RiskLevel | null;
  experimentalRisk: ExperimentalRiskBody | null;
  experimentalRiskUnavailableReason: 'SCORED_WITHOUT_RESEARCH_POLICY' | null;
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
  /** Nivel global: siempre null (sin ensemble ni política aprobada). */
  riskLevel: RiskLevel | null;
  riskPolicyStatus: RiskPolicyStatus;
  riskPolicyVersion: string | null;
  /** Sin clasificación operativa NI experimental. */
  classificationUnavailable: boolean;
  operationalClassificationUnavailable: boolean;
  experimentalClassificationUnavailable: boolean;
  /** RESEARCH_PROVISIONAL si algún modelo trae banda experimental; null si no. */
  classificationBasis: 'RESEARCH_PROVISIONAL' | null;
  experimentalRiskNotice: string | null;
  validationStatus: 'EXPLORATORY_NOT_VALIDATED';
  operationalUseAllowed: false;
  message: string;
}

const MESSAGES: Readonly<Record<RiskAssessment['status'], string>> = {
  AVAILABLE_EXPLORATORY:
    'Estimación experimental no calibrada (EXPLORATORY_NOT_VALIDATED). Niveles de riesgo operativos pendientes de validación; no usar para decisiones operativas.',
  NOT_SCORED:
    'Existe evidencia válida de la reserva pero aún no se solicitó la predicción (acción explícita POST .../predictions).',
  NOT_SCORABLE:
    'No es posible estimar sin evidencia temporal de la creación de la reserva; no se genera un score sustituto.',
};

const EXPERIMENTAL_MESSAGE =
  'Estimación experimental no calibrada (EXPLORATORY_NOT_VALIDATED) con banda relativa exploratoria por modelo (RESEARCH_PROVISIONAL). Riesgo operativo pendiente de validación; no usar para decisiones operativas.';

export function toExperimentalRiskBody(risk: ExperimentalRisk): ExperimentalRiskBody {
  return {
    level: risk.level,
    label: risk.label,
    status: risk.status,
    classificationBasis: 'RESEARCH_PROVISIONAL',
    policyId: risk.policyId,
    policyVersion: risk.policyVersion,
    policyHash: risk.policyHash,
    lowUpperThreshold: risk.lowUpperThreshold,
    highLowerThreshold: risk.highLowerThreshold,
    boundaryRule: risk.boundaryRule,
    meaning: risk.meaning,
    scoreSpace: risk.scoreSpace,
    warnings: [...risk.warnings],
    approvedBy: null,
    operationalUseAllowed: false,
  };
}

export function toRiskAssessmentBody(assessment: RiskAssessment): RiskAssessmentBody {
  const snapshot = assessment.snapshot;
  const experimental = assessment.experimentalClassificationAvailable;
  const operational = assessment.operationalClassificationAvailable;

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
      modelHashSha256: model.modelHashSha256,
      scoringApiVersion: model.scoringApiVersion,
      probabilityNoShow: model.probabilityNoShow,
      percentageNoShow: model.probabilityNoShow * 100,
      target: model.predictionTarget,
      validationStatus: model.validationStatus,
      calibrationStatus: model.calibrationStatus,
      operationalUseAllowed: false,
      riskLevel: model.policyRiskLevel,
      experimentalRisk: model.experimentalRisk
        ? toExperimentalRiskBody(model.experimentalRisk)
        : null,
      experimentalRiskUnavailableReason: model.experimentalRisk
        ? null
        : 'SCORED_WITHOUT_RESEARCH_POLICY',
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
    classificationUnavailable: !operational && !experimental,
    operationalClassificationUnavailable: !operational,
    experimentalClassificationUnavailable: !experimental,
    classificationBasis: experimental ? 'RESEARCH_PROVISIONAL' : null,
    experimentalRiskNotice: experimental ? EXPERIMENTAL_RISK_NOTICE : null,
    validationStatus: 'EXPLORATORY_NOT_VALIDATED',
    operationalUseAllowed: false,
    message:
      assessment.status === 'AVAILABLE_EXPLORATORY' && experimental
        ? EXPERIMENTAL_MESSAGE
        : MESSAGES[assessment.status],
  };
}
