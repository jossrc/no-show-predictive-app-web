import type { z } from 'zod';
import type {
  BatchResponseSchema,
  CompareResponseSchema,
  ExplanationResponseSchema,
  FactorSchema,
  ModelDescriptorSchema,
  ModelsResponseSchema,
  PredictionResponseSchema,
  ReadyResponseSchema,
} from './MlContractSchemas.js';
import type { MlModelKey, PredictionFeatures } from './MlFeatureContract.js';

export interface MlFeatureContext {
  snapshot_type: 'booking_creation';
  builder_version: string;
}

export interface MlCompareRequest {
  feature_version: string;
  feature_context: MlFeatureContext;
  features: PredictionFeatures;
}

export interface MlPredictionRequest extends MlCompareRequest {
  model_key: MlModelKey;
}

export interface MlExplanationRequest extends MlPredictionRequest {
  top_k: number;
}

export type MlBatchRequest =
  | {
      mode: 'single';
      model_key: MlModelKey;
      feature_version: string;
      feature_context: MlFeatureContext;
      items: ReadonlyArray<{ features: PredictionFeatures }>;
    }
  | {
      mode: 'compare';
      feature_version: string;
      feature_context: MlFeatureContext;
      items: ReadonlyArray<{ features: PredictionFeatures }>;
    };

export type MlPredictionResponse = z.infer<typeof PredictionResponseSchema>;
export type MlCompareResponse = z.infer<typeof CompareResponseSchema>;
export type MlExplanationResponse = z.infer<typeof ExplanationResponseSchema>;
export type MlExplanationFactor = z.infer<typeof FactorSchema>;
export type MlBatchResponse = z.infer<typeof BatchResponseSchema>;
export type MlModelsResponse = z.infer<typeof ModelsResponseSchema>;
export type MlModelDescriptor = z.infer<typeof ModelDescriptorSchema>;
export type MlReadyResponse = z.infer<typeof ReadyResponseSchema>;
