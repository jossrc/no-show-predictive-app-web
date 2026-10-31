import type {
  ReservationBody,
  ScoreSummaryBody,
} from '../../../../../Reservations/Shared/http/ReservationHttpMapper.js';
import type { ExperimentalRiskSummary } from '../../../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { NotScorableReason } from '../../../../Shared/models/NotScorableReason.js';

export interface ListReservationRisksItemBody extends ReservationBody {
  risk: {
    predictionAvailability: 'AVAILABLE_EXPLORATORY' | 'NOT_SCORED' | 'NOT_SCORABLE';
    notScorableReasons: NotScorableReason[];
    riskLevel: null;
    riskPolicyStatus: 'pending_validation' | 'approved';
    classificationUnavailable: boolean;
    operationalClassificationUnavailable: boolean;
    experimentalClassificationUnavailable: boolean;
    experimentalRisk: ExperimentalRiskSummary | null;
    experimentalPolicyCurrent: boolean;
    validationStatus: 'EXPLORATORY_NOT_VALIDATED';
    probabilities: ScoreSummaryBody[];
  };
}

export interface ListExperimentalRiskPolicyBody {
  modelKey: string;
  policyId: string;
  policyVersion: string;
  policyHash: string;
  status: 'RESEARCH_PROVISIONAL';
  classificationBasis: 'RESEARCH_PROVISIONAL';
  operationalUseAllowed: false;
  notice: string;
}

export interface ListReservationRisksResponse {
  data: ListReservationRisksItemBody[];
  pagination: { limit: number; nextCursor: string | null };
  period: {
    from: string;
    to: string;
    timeZone: string;
    startInclusive: string;
    endExclusive: string;
  };
  sort: { field: string; direction: 'asc' | 'desc'; modelKey: string; semantics: string };
  riskPolicyStatus: 'pending_validation' | 'approved';
  classificationUnavailable: boolean;
  operationalClassificationUnavailable: boolean;
  experimentalClassificationUnavailable: boolean;
  experimentalRiskPolicy: ListExperimentalRiskPolicyBody | null;
  sourceStatus: string;
  predictiveStoreAvailable: boolean;
  requestId: string;
}
