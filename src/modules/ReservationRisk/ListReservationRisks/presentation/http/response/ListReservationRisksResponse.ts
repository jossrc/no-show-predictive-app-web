import type {
  ReservationBody,
  ScoreSummaryBody,
} from '../../../../../Reservations/Shared/http/ReservationHttpMapper.js';
import type { NotScorableReason } from '../../../../Shared/models/NotScorableReason.js';

export interface ListReservationRisksItemBody extends ReservationBody {
  risk: {
    predictionAvailability: 'AVAILABLE_EXPLORATORY' | 'NOT_SCORED' | 'NOT_SCORABLE';
    notScorableReasons: NotScorableReason[];
    riskLevel: null;
    riskPolicyStatus: 'pending_validation' | 'approved';
    classificationUnavailable: boolean;
    validationStatus: 'EXPLORATORY_NOT_VALIDATED';
    probabilities: ScoreSummaryBody[];
  };
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
  sourceStatus: string;
  predictiveStoreAvailable: boolean;
  requestId: string;
}
