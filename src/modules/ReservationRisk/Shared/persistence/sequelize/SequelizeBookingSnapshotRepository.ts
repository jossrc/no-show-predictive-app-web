import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { PredictionFeatures } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type {
  BookingFeatureSnapshot,
  NewBookingFeatureSnapshot,
} from '../../models/BookingFeatureSnapshot.js';
import type { BookingSnapshotRepository } from '../BookingSnapshotRepository.js';
import { toPersistenceException } from './PredictiveStoreErrors.js';

const SNAPSHOT_COLUMNS = `
  snapshot_id::text AS snapshot_id, reservation_id::text AS reservation_id,
  client_id::text AS client_id, snapshot_type, prediction_at, appointment_at,
  feature_version, builder_version, snapshot_hash, features, evidence_source, created_at`;

const FIND_LATEST_SQL = `
SELECT ${SNAPSHOT_COLUMNS}
FROM ml.booking_feature_snapshots
WHERE reservation_id = $1::bigint AND evidence_source = $2
ORDER BY created_at DESC, snapshot_id DESC
LIMIT 1`;

const INSERT_SQL = `
INSERT INTO ml.booking_feature_snapshots (
  reservation_id, client_id, snapshot_type, prediction_at, appointment_at, feature_version,
  builder_version, snapshot_hash, features, evidence_source, evidence, source_ingestion_batch_id
) VALUES (
  $1::bigint, $2::bigint, 'booking_creation', $3::timestamptz, $4::timestamptz, $5, $6, $7,
  $8::jsonb, $9, $10::jsonb, $11::bigint
)
ON CONFLICT (reservation_id, snapshot_hash) DO NOTHING
RETURNING ${SNAPSHOT_COLUMNS}`;

const FIND_BY_HASH_SQL = `
SELECT ${SNAPSHOT_COLUMNS}
FROM ml.booking_feature_snapshots
WHERE reservation_id = $1::bigint AND snapshot_hash = $2`;

interface SnapshotRow {
  snapshot_id: string;
  reservation_id: string;
  client_id: string;
  snapshot_type: 'booking_creation';
  prediction_at: Date;
  appointment_at: Date;
  feature_version: string;
  builder_version: string;
  snapshot_hash: string;
  features: PredictionFeatures;
  evidence_source: SnapshotEvidenceSource;
  created_at: Date;
}

function mapRow(row: SnapshotRow): BookingFeatureSnapshot {
  return {
    snapshotId: row.snapshot_id,
    reservationId: row.reservation_id,
    clientId: row.client_id,
    snapshotType: row.snapshot_type,
    predictionAt: row.prediction_at,
    appointmentAt: row.appointment_at,
    featureVersion: row.feature_version,
    builderVersion: row.builder_version,
    snapshotHash: row.snapshot_hash,
    features: row.features,
    evidenceSource: row.evidence_source,
    createdAt: row.created_at,
  };
}

export class SequelizeBookingSnapshotRepository implements BookingSnapshotRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async findLatestUsable(
    reservationId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<BookingFeatureSnapshot | null> {
    try {
      const [row] = await this.sequelize.query<SnapshotRow>(FIND_LATEST_SQL, {
        bind: [reservationId, evidence],
        type: QueryTypes.SELECT,
      });
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toPersistenceException('FindBookingSnapshot', error);
    }
  }

  async saveIfAbsent(snapshot: NewBookingFeatureSnapshot): Promise<BookingFeatureSnapshot> {
    try {
      const [inserted] = await this.sequelize.query<SnapshotRow>(INSERT_SQL, {
        bind: [
          snapshot.reservationId,
          snapshot.clientId,
          snapshot.predictionAt,
          snapshot.appointmentAt,
          snapshot.featureVersion,
          snapshot.builderVersion,
          snapshot.snapshotHash,
          JSON.stringify(snapshot.features),
          snapshot.evidenceSource,
          JSON.stringify(snapshot.evidence),
          snapshot.sourceIngestionBatchId,
        ],
        type: QueryTypes.SELECT,
      });
      if (inserted) return mapRow(inserted);

      // Conflicto: otra petición ya guardó el mismo snapshot. Nueva sentencia = nueva foto MVCC.
      const [existing] = await this.sequelize.query<SnapshotRow>(FIND_BY_HASH_SQL, {
        bind: [snapshot.reservationId, snapshot.snapshotHash],
        type: QueryTypes.SELECT,
      });
      if (!existing) throw new Error('Snapshot en conflicto no localizado');
      return mapRow(existing);
    } catch (error) {
      throw toPersistenceException('SaveBookingSnapshot', error);
    }
  }
}
