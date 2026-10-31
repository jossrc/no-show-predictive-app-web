import { ML_FEATURE_VERSION } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import { SnapshotIntegrityException } from '../errors/SnapshotIntegrityException.js';
import type { BookingFeatureSnapshot } from '../models/BookingFeatureSnapshot.js';
import { validateFeatureSnapshot } from '../validation/ValidateFeatureSnapshot.js';
import { computeSnapshotHash } from './SnapshotHash.js';

/** Antes de reutilizar un snapshot persistido: contrato vigente, coherencia y hash intactos. */
export function verifySnapshotIntegrity(
  snapshot: BookingFeatureSnapshot,
  reservationId: string,
): BookingFeatureSnapshot {
  const intact =
    snapshot.reservationId === reservationId &&
    snapshot.snapshotType === 'booking_creation' &&
    snapshot.featureVersion === ML_FEATURE_VERSION &&
    validateFeatureSnapshot(snapshot.features).length === 0 &&
    computeSnapshotHash({
      reservationId: snapshot.reservationId,
      predictionAt: snapshot.predictionAt,
      featureVersion: snapshot.featureVersion,
      builderVersion: snapshot.builderVersion,
      features: snapshot.features,
    }) === snapshot.snapshotHash;

  if (!intact) throw new SnapshotIntegrityException(snapshot.snapshotId);
  return snapshot;
}
