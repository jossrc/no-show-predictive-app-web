import type {
  EligibilityBody,
  OverbookingAuthorizationBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';

export interface GetOverbookingAuthorizationResponse {
  data: {
    reservationId: string;
    enabled: boolean;
    status: 'ENABLED' | 'NOT_ENABLED';
    statusLabel: string;
    authorization: OverbookingAuthorizationBody | null;
    eligibility: EligibilityBody;
  };
  requestId: string;
}
