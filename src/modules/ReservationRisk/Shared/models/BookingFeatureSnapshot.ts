import type { PredictionFeatures } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';

/** Snapshot inmutable persistido en ml.booking_feature_snapshots. */
export interface BookingFeatureSnapshot {
  readonly snapshotId: DecimalId;
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly snapshotType: 'booking_creation';
  readonly predictionAt: Date;
  readonly appointmentAt: Date;
  readonly featureVersion: string;
  readonly builderVersion: string;
  readonly snapshotHash: string;
  readonly features: PredictionFeatures;
  readonly evidenceSource: SnapshotEvidenceSource;
  readonly createdAt: Date;
}

export type NewBookingFeatureSnapshot = Omit<BookingFeatureSnapshot, 'snapshotId' | 'createdAt'> & {
  /** Evidencia mínima no identificable (tablas, marcas temporales, lote de ingesta). */
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly sourceIngestionBatchId: string | null;
};
