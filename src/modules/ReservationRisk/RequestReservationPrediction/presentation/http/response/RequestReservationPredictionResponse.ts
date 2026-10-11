import type { RiskAssessmentBody } from '../../../../Shared/http/RiskAssessmentHttpMapper.js';

export interface RequestReservationPredictionResponse {
  data: RiskAssessmentBody & {
    run: {
      predictionRunId: string | null;
      replayed: boolean;
      requestedModelKeys: string[];
      snapshotCreated: boolean;
    };
    featureWarnings: string[];
  };
  requestId: string;
}
