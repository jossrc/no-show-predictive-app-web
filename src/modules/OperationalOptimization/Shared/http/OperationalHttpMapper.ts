import { OVERBOOKING_STATUS_LABELS } from '../../../Reservations/Shared/http/OperationalStatusHttp.js';
import type {
  AttendanceComparison,
  AttendanceOutcome,
  OverbookingAuthorization,
  SpaceRecoveryOutcome,
} from '../models/OperationalRecords.js';
import type { RecordListPeriod } from '../pagination/RecordListQuery.js';
import { BINARY_OUTCOME_NOTICE } from '../rules/BinaryOutcomeComparison.js';
import type {
  OverbookingCandidate,
  OverbookingEligibility,
  OverbookingIneligibilityReason,
} from '../rules/OverbookingEligibility.js';

interface AuthorshipBody {
  actorKind: 'INTERNAL_SERVICE';
  actorUserId: null;
}

export interface OverbookingAuthorizationBody extends AuthorshipBody {
  authorizationId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  status: 'ENABLED';
  statusLabel: string;
  enabledAt: string;
  modelKey: string;
  modelVersion: string;
  predictionRunId: string;
  riskBandAtAuthorization: 'HIGH';
  probabilityNoShowAtAuthorization: number;
  researchPolicyHash: string;
  researchPolicyVersion: string;
  scoredAt: string;
  eligibilityRuleVersion: string;
}

export interface EligibilityBody {
  ruleVersion: string;
  eligible: boolean;
  reasons: OverbookingIneligibilityReason[];
  candidates: Array<{
    modelKey: string;
    predictionRunId: string;
    probabilityNoShow: number;
    scoredAt: string;
    experimentalRiskLevel: OverbookingCandidate['experimentalRiskLevel'];
    researchPolicyHash: string | null;
    eligible: boolean;
    reasons: OverbookingIneligibilityReason[];
  }>;
}

export interface ComparisonBody {
  modelKey: string;
  modelVersion: string;
  probabilityNoShow: number;
  scoredAt: string;
  experimentalRiskLevel: AttendanceComparison['experimentalRiskLevel'];
  comparisonRuleVersion: string;
  threshold: number;
  predictedNoShow: boolean;
  observedNoShow: boolean;
  matchesPrediction: boolean;
}

export interface AttendanceOutcomeBody extends AuthorshipBody {
  attendanceOutcomeId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  appointmentEndAt: string | null;
  attendanceStatus: AttendanceOutcome['attendanceStatus'];
  observedNoShow: boolean;
  recordedAt: string;
  predictionRunId: string;
  finishedRuleVersion: string;
  comparisons: ComparisonBody[];
  comparisonNotice: string;
}

export interface SpaceRecoveryOutcomeBody extends AuthorshipBody {
  recoveryOutcomeId: string;
  authorizationId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  spaceRecovered: boolean;
  recordedAt: string;
}

export interface PeriodBody {
  from: string;
  to: string;
  timeZone: string;
  startInclusive: string;
  endExclusive: string;
}

const authorship: AuthorshipBody = { actorKind: 'INTERNAL_SERVICE', actorUserId: null };

export function toAuthorizationBody(
  authorization: OverbookingAuthorization,
): OverbookingAuthorizationBody {
  return {
    authorizationId: authorization.authorizationId,
    reservationId: authorization.reservationId,
    clinicId: authorization.clinicId,
    appointmentAt: authorization.appointmentAt.toISOString(),
    status: authorization.status,
    statusLabel: OVERBOOKING_STATUS_LABELS.ENABLED,
    enabledAt: authorization.enabledAt.toISOString(),
    modelKey: authorization.modelKey,
    modelVersion: authorization.modelVersion,
    predictionRunId: authorization.predictionRunId,
    riskBandAtAuthorization: authorization.riskBandAtAuthorization,
    probabilityNoShowAtAuthorization: authorization.probabilityNoShowAtAuthorization,
    researchPolicyHash: authorization.researchPolicyHash,
    researchPolicyVersion: authorization.researchPolicyVersion,
    scoredAt: authorization.scoredAt.toISOString(),
    eligibilityRuleVersion: authorization.eligibilityRuleVersion,
    ...authorship,
  };
}

export function toEligibilityBody(eligibility: OverbookingEligibility): EligibilityBody {
  return {
    ruleVersion: eligibility.ruleVersion,
    eligible: eligibility.eligible,
    reasons: eligibility.reasons.map((reason) => ({ ...reason })),
    candidates: eligibility.candidates.map((candidate) => ({
      modelKey: candidate.modelKey,
      predictionRunId: candidate.predictionRunId,
      probabilityNoShow: candidate.probabilityNoShow,
      scoredAt: candidate.scoredAt.toISOString(),
      experimentalRiskLevel: candidate.experimentalRiskLevel,
      researchPolicyHash: candidate.researchPolicyHash,
      eligible: candidate.eligible,
      reasons: candidate.reasons.map((reason) => ({ ...reason })),
    })),
  };
}

export function toAttendanceOutcomeBody(outcome: AttendanceOutcome): AttendanceOutcomeBody {
  return {
    attendanceOutcomeId: outcome.attendanceOutcomeId,
    reservationId: outcome.reservationId,
    clinicId: outcome.clinicId,
    appointmentAt: outcome.appointmentAt.toISOString(),
    appointmentEndAt: outcome.appointmentEndAt?.toISOString() ?? null,
    attendanceStatus: outcome.attendanceStatus,
    observedNoShow: outcome.observedNoShow,
    recordedAt: outcome.recordedAt.toISOString(),
    predictionRunId: outcome.predictionRunId,
    finishedRuleVersion: outcome.finishedRuleVersion,
    comparisons: outcome.comparisons.map((comparison) => ({
      modelKey: comparison.modelKey,
      modelVersion: comparison.modelVersion,
      probabilityNoShow: comparison.probabilityNoShow,
      scoredAt: comparison.scoredAt.toISOString(),
      experimentalRiskLevel: comparison.experimentalRiskLevel,
      comparisonRuleVersion: comparison.comparisonRuleVersion,
      threshold: comparison.threshold,
      predictedNoShow: comparison.predictedNoShow,
      observedNoShow: comparison.observedNoShow,
      matchesPrediction: comparison.matchesPrediction,
    })),
    comparisonNotice: BINARY_OUTCOME_NOTICE,
    ...authorship,
  };
}

export function toSpaceRecoveryOutcomeBody(
  outcome: SpaceRecoveryOutcome,
): SpaceRecoveryOutcomeBody {
  return {
    recoveryOutcomeId: outcome.recoveryOutcomeId,
    authorizationId: outcome.authorizationId,
    reservationId: outcome.reservationId,
    clinicId: outcome.clinicId,
    appointmentAt: outcome.appointmentAt.toISOString(),
    spaceRecovered: outcome.spaceRecovered,
    recordedAt: outcome.recordedAt.toISOString(),
    ...authorship,
  };
}

export function toPeriodBody(period: RecordListPeriod): PeriodBody {
  return {
    from: period.from,
    to: period.to,
    timeZone: period.timeZone,
    startInclusive: period.startInclusive.toISOString(),
    endExclusive: period.endExclusive.toISOString(),
  };
}
