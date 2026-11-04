import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type {
  ExperimentalRiskLevel,
  ReservationScoreSummary,
} from '../../../Reservations/Shared/models/ReservationScoreSummary.js';

/**
 * Regla `overbooking_eligibility_v1` (HU-06). Un horario puede MARCARSE para análisis de
 * sobreasignación si: la reserva fuente está programada (SCHEDULED) y su cita es futura según el
 * Clock; y el ÚLTIMO score persistido del modelo elegido tiene banda experimental HIGH bajo la
 * política research vigente de ese modelo. No usa `riskLevel` operativo (null: política
 * pendiente) ni combina RF/XGB: cada modelo se evalúa por separado.
 */
export const OVERBOOKING_ELIGIBILITY_RULE_VERSION = 'overbooking_eligibility_v1';

export const OVERBOOKING_INELIGIBILITY_MESSAGES = {
  ALREADY_ENABLED: 'El horario ya está habilitado para sobreasignación',
  RESERVATION_NOT_SCHEDULED: 'La reserva no está programada (cancelada o pasada)',
  APPOINTMENT_NOT_FUTURE: 'La cita ya comenzó o pasó',
  NOT_SCORED: 'La reserva no tiene predicciones persistidas',
  EXPERIMENTAL_BAND_UNAVAILABLE: 'La predicción no tiene banda experimental research v2',
  PREDICTION_NOT_HIGH: 'La banda experimental de la predicción no es Alta',
  RESEARCH_POLICY_NOT_CURRENT: 'La predicción usa una política research que ya no es la vigente',
  PREDICTION_NOT_LATEST:
    'La predicción indicada no es la última del modelo para esta reserva; vuelva a consultar',
} as const;

export type OverbookingIneligibilityCode = keyof typeof OVERBOOKING_INELIGIBILITY_MESSAGES;

export interface OverbookingIneligibilityReason {
  readonly code: OverbookingIneligibilityCode;
  readonly message: string;
}

export function ineligibility(code: OverbookingIneligibilityCode): OverbookingIneligibilityReason {
  return { code, message: OVERBOOKING_INELIGIBILITY_MESSAGES[code] };
}

export interface OverbookingCandidate {
  readonly modelKey: MlModelKey;
  readonly predictionRunId: string;
  readonly probabilityNoShow: number;
  readonly scoredAt: Date;
  readonly experimentalRiskLevel: ExperimentalRiskLevel | null;
  readonly researchPolicyHash: string | null;
  readonly eligible: boolean;
  readonly reasons: readonly OverbookingIneligibilityReason[];
}

export interface OverbookingEligibility {
  readonly ruleVersion: typeof OVERBOOKING_ELIGIBILITY_RULE_VERSION;
  /** true ⇒ el frontend puede ofrecer la acción con cualquiera de los candidatos elegibles. */
  readonly eligible: boolean;
  /** Motivos a nivel de reserva (aplican a todos los modelos). */
  readonly reasons: readonly OverbookingIneligibilityReason[];
  readonly candidates: readonly OverbookingCandidate[];
}

export interface OverbookingEligibilityInput {
  readonly reservation: Reservation;
  readonly now: Date;
  /** Último score por modelo de la reserva (evidencia del modo activo). */
  readonly latestScores: readonly ReservationScoreSummary[];
  /** Hash de la política research vigente por modelo (null si el modelo no tiene banda v2). */
  readonly currentPolicyHashes: ReadonlyMap<MlModelKey, string | null>;
  readonly alreadyEnabled: boolean;
}

function evaluateCandidate(
  score: ReservationScoreSummary,
  currentPolicyHash: string | null,
): OverbookingCandidate {
  const risk = score.experimentalRisk;
  const reasons: OverbookingIneligibilityReason[] = [];
  if (!risk) reasons.push(ineligibility('EXPERIMENTAL_BAND_UNAVAILABLE'));
  else {
    if (risk.level !== 'HIGH') reasons.push(ineligibility('PREDICTION_NOT_HIGH'));
    if (risk.policyHash !== currentPolicyHash) {
      reasons.push(ineligibility('RESEARCH_POLICY_NOT_CURRENT'));
    }
  }
  return {
    modelKey: score.modelKey,
    predictionRunId: score.predictionRunId,
    probabilityNoShow: score.probabilityNoShow,
    scoredAt: score.scoredAt,
    experimentalRiskLevel: risk?.level ?? null,
    researchPolicyHash: risk?.policyHash ?? null,
    eligible: reasons.length === 0,
    reasons,
  };
}

export function evaluateOverbookingEligibility(
  input: OverbookingEligibilityInput,
): OverbookingEligibility {
  const reasons: OverbookingIneligibilityReason[] = [];
  if (input.alreadyEnabled) reasons.push(ineligibility('ALREADY_ENABLED'));
  if (input.reservation.status !== 'SCHEDULED') {
    reasons.push(ineligibility('RESERVATION_NOT_SCHEDULED'));
  }
  if (input.reservation.appointmentAt.getTime() <= input.now.getTime()) {
    reasons.push(ineligibility('APPOINTMENT_NOT_FUTURE'));
  }
  if (input.latestScores.length === 0) reasons.push(ineligibility('NOT_SCORED'));

  const candidates = [...input.latestScores]
    .sort((left, right) => left.modelKey.localeCompare(right.modelKey))
    .map((score) =>
      evaluateCandidate(score, input.currentPolicyHashes.get(score.modelKey) ?? null),
    );

  return {
    ruleVersion: OVERBOOKING_ELIGIBILITY_RULE_VERSION,
    eligible: reasons.length === 0 && candidates.some((candidate) => candidate.eligible),
    reasons,
    candidates,
  };
}
