import type { DatabaseSync } from 'node:sqlite';
import { toCanonicalFeatures } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type {
  BookingFeatureSnapshot,
  NewBookingFeatureSnapshot,
} from '../../models/BookingFeatureSnapshot.js';
import type { BookingSnapshotRepository } from '../BookingSnapshotRepository.js';
import { iso, mapSnapshotRow, toStoreException, type SqliteRow } from './SqliteRows.js';

const SNAPSHOT_COLUMNS = `
  snapshot_id, reservation_id, client_id, snapshot_type, prediction_at, appointment_at,
  feature_version, builder_version, snapshot_hash, features_json, evidence_source, created_at`;

/** Snapshots booking_creation inmutables en el almacén local (UNIQUE reserva+hash). */
export class SqliteBookingSnapshotRepository implements BookingSnapshotRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findLatestUsable(
    reservationId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<BookingFeatureSnapshot | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT ${SNAPSHOT_COLUMNS} FROM booking_feature_snapshots
           WHERE reservation_id = ? AND evidence_source = ?
           ORDER BY created_at DESC, snapshot_id DESC LIMIT 1`,
        )
        .get(reservationId, evidence);
      return row ? mapSnapshotRow(row as SqliteRow) : null;
    } catch (error) {
      throw toStoreException('FindBookingSnapshot', error);
    }
  }

  async saveIfAbsent(snapshot: NewBookingFeatureSnapshot): Promise<BookingFeatureSnapshot> {
    try {
      const inserted = this.db
        .prepare(
          `INSERT INTO booking_feature_snapshots (
             reservation_id, client_id, snapshot_type, prediction_at, appointment_at,
             feature_version, builder_version, snapshot_hash, features_json, evidence_source,
             evidence_json, source_ingestion_batch_id, created_at
           ) VALUES (?, ?, 'booking_creation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (reservation_id, snapshot_hash) DO NOTHING
           RETURNING ${SNAPSHOT_COLUMNS}`,
        )
        .get(
          snapshot.reservationId,
          snapshot.clientId,
          iso(snapshot.predictionAt),
          iso(snapshot.appointmentAt),
          snapshot.featureVersion,
          snapshot.builderVersion,
          snapshot.snapshotHash,
          JSON.stringify(toCanonicalFeatures(snapshot.features)),
          snapshot.evidenceSource,
          JSON.stringify(snapshot.evidence),
          snapshot.sourceIngestionBatchId,
          iso(this.now()),
        );
      if (inserted) return mapSnapshotRow(inserted as SqliteRow);

      // Conflicto: otra petición ya guardó la misma foto; se devuelve la original intacta.
      const existing = this.db
        .prepare(
          `SELECT ${SNAPSHOT_COLUMNS} FROM booking_feature_snapshots
           WHERE reservation_id = ? AND snapshot_hash = ?`,
        )
        .get(snapshot.reservationId, snapshot.snapshotHash);
      if (!existing) throw new Error('Snapshot en conflicto no localizado');
      return mapSnapshotRow(existing as SqliteRow);
    } catch (error) {
      throw toStoreException('SaveBookingSnapshot', error);
    }
  }
}
