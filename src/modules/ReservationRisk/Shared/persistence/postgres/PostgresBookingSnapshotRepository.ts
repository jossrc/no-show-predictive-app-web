import {
  toAppStoreException,
  type AppStoreQueryable,
} from '../../../../../infrastructure/database/postgres/PredictiveAppDatabase.js';
import { toCanonicalFeatures } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type {
  BookingFeatureSnapshot,
  NewBookingFeatureSnapshot,
} from '../../models/BookingFeatureSnapshot.js';
import type { BookingSnapshotRepository } from '../BookingSnapshotRepository.js';
import { mapSnapshotRow, SNAPSHOT_COLUMNS, type PgRow } from './PostgresRows.js';

/** Snapshots booking_creation inmutables en ml.app_booking_feature_snapshots (UNIQUE reserva+hash). */
export class PostgresBookingSnapshotRepository implements BookingSnapshotRepository {
  constructor(
    private readonly db: AppStoreQueryable,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findLatestUsable(
    reservationId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<BookingFeatureSnapshot | null> {
    try {
      const [row] = await this.db.query<PgRow>(
        `SELECT ${SNAPSHOT_COLUMNS} FROM ml.app_booking_feature_snapshots
         WHERE reservation_id = $1::bigint AND evidence_source = $2
         ORDER BY created_at DESC, snapshot_id DESC LIMIT 1`,
        [reservationId, evidence],
      );
      return row ? mapSnapshotRow(row) : null;
    } catch (error) {
      throw toAppStoreException('FindBookingSnapshot', error);
    }
  }

  async saveIfAbsent(snapshot: NewBookingFeatureSnapshot): Promise<BookingFeatureSnapshot> {
    try {
      const [inserted] = await this.db.query<PgRow>(
        `INSERT INTO ml.app_booking_feature_snapshots (
           reservation_id, client_id, snapshot_type, prediction_at, appointment_at,
           feature_version, builder_version, snapshot_hash, features, evidence_source,
           evidence, source_ingestion_batch_id, created_at
         ) VALUES ($1::bigint, $2::bigint, 'booking_creation', $3, $4, $5, $6, $7, $8::jsonb, $9,
                   $10::jsonb, $11, $12)
         ON CONFLICT (reservation_id, snapshot_hash) DO NOTHING
         RETURNING ${SNAPSHOT_COLUMNS}`,
        [
          snapshot.reservationId,
          snapshot.clientId,
          snapshot.predictionAt,
          snapshot.appointmentAt,
          snapshot.featureVersion,
          snapshot.builderVersion,
          snapshot.snapshotHash,
          JSON.stringify(toCanonicalFeatures(snapshot.features)),
          snapshot.evidenceSource,
          JSON.stringify(snapshot.evidence),
          snapshot.sourceIngestionBatchId,
          this.now(),
        ],
      );
      if (inserted) return mapSnapshotRow(inserted);

      // Conflicto: otra petición ya guardó la misma foto; se devuelve la original intacta.
      const [existing] = await this.db.query<PgRow>(
        `SELECT ${SNAPSHOT_COLUMNS} FROM ml.app_booking_feature_snapshots
         WHERE reservation_id = $1::bigint AND snapshot_hash = $2`,
        [snapshot.reservationId, snapshot.snapshotHash],
      );
      if (!existing) throw new Error('Snapshot en conflicto no localizado');
      return mapSnapshotRow(existing);
    } catch (error) {
      throw toAppStoreException('SaveBookingSnapshot', error);
    }
  }
}
