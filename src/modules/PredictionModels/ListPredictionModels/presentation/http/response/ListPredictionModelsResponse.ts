import type { ListPredictionModelsResult } from '../../../application/result/ListPredictionModelsResult.js';

export interface ListPredictionModelsResponse {
  data: ListPredictionModelsResult;
  requestId: string;
}
