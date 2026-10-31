/**
 * Procedencia de los datos que alimentan reservas, snapshots e historial (mutuamente excluyentes).
 * - READ_ONLY_EXISTING_SCHEDULE: raw_flow/analytics reales en solo lectura + snapshots con
 *   evidencia VERIFIED_BOOKING_SNAPSHOT (si existieran).
 * - SYNTHETIC_DEMO_ONLY: BD de prueba con fixtures sintéticas; nunca datos comerciales.
 */
export const DATA_SOURCE_MODES = ['READ_ONLY_EXISTING_SCHEDULE', 'SYNTHETIC_DEMO_ONLY'] as const;

export type DataSourceMode = (typeof DATA_SOURCE_MODES)[number];

export type SnapshotEvidenceSource = 'VERIFIED_BOOKING_SNAPSHOT' | 'SYNTHETIC_DEMO_ONLY';

/** Única evidencia de snapshot utilizable en cada modo: nunca se mezclan. */
export function allowedSnapshotEvidence(mode: DataSourceMode): SnapshotEvidenceSource {
  return mode === 'SYNTHETIC_DEMO_ONLY' ? 'SYNTHETIC_DEMO_ONLY' : 'VERIFIED_BOOKING_SNAPSHOT';
}
