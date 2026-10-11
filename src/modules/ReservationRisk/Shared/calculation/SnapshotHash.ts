import { createHash } from 'node:crypto';
import {
  toCanonicalFeatures,
  type PredictionFeatures,
} from '../../../../infrastructure/http/ml/MlFeatureContract.js';

export interface SnapshotHashInput {
  readonly reservationId: string;
  readonly predictionAt: Date;
  readonly featureVersion: string;
  readonly builderVersion: string;
  readonly features: PredictionFeatures;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('Valor no serializable en snapshot');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/**
 * SHA-256 hexadecimal sobre JSON canónico (claves ordenadas, números en representación
 * round-trip). Misma evidencia ⇒ mismo hash, sin depender del reloj ni del orden de claves.
 */
export function computeSnapshotHash(input: SnapshotHashInput): string {
  const payload = canonicalJson({
    snapshot_type: 'booking_creation',
    reservation_id: input.reservationId,
    prediction_at: input.predictionAt.toISOString(),
    feature_version: input.featureVersion,
    builder_version: input.builderVersion,
    features: toCanonicalFeatures(input.features),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
