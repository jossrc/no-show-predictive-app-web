import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ScoringApiVersion } from './ModelScore.js';

export type PredictionMode = 'single' | 'compare';

/** Ejecución auditable de inferencia solicitada explícitamente (POST). */
export interface NewPredictionRun {
  readonly runUid: string;
  readonly snapshotId: DecimalId;
  readonly reservationId: DecimalId;
  readonly mode: PredictionMode;
  readonly requestedModelKeys: readonly MlModelKey[];
  readonly requestId: string;
  readonly runRequestedAt: Date;
  readonly completedAt: Date;
  readonly mlLatencyMs: number;
  readonly scoringApiVersion: ScoringApiVersion;
}
