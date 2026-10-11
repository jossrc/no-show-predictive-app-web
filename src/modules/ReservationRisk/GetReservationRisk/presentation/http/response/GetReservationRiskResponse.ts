import type { RiskAssessmentBody } from '../../../../Shared/http/RiskAssessmentHttpMapper.js';

export interface GetReservationRiskResponse {
  data: RiskAssessmentBody;
  requestId: string;
}
