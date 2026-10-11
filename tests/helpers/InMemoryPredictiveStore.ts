import type { SnapshotEvidenceSource } from '../../src/shared/data/DataSourceMode.js';
import type {
  BookingFeatureSnapshot,
  NewBookingFeatureSnapshot,
} from '../../src/modules/ReservationRisk/Shared/models/BookingFeatureSnapshot.js';
import type {
  ModelScore,
  NewModelScore,
} from '../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import type { NewPredictionRun } from '../../src/modules/ReservationRisk/Shared/models/PredictionRun.js';
import type { BookingSnapshotRepository } from '../../src/modules/ReservationRisk/Shared/persistence/BookingSnapshotRepository.js';
import type {
  ModelIdentity,
  PredictionResultRepository,
  SavePredictionRunOutcome,
} from '../../src/modules/ReservationRisk/Shared/persistence/PredictionResultRepository.js';

/** Almacén predictivo en memoria con las mismas reglas UNIQUE/inmutabilidad que el schema ml. */
export class InMemoryPredictiveStore
  implements BookingSnapshotRepository, PredictionResultRepository
{
  readonly snapshots: BookingFeatureSnapshot[] = [];
  readonly runs: NewPredictionRun[] = [];
  readonly results: ModelScore[] = [];
  failNextSaveRun: Error | null = null;
  private sequence = 1;

  addSnapshot(snapshot: BookingFeatureSnapshot): void {
    this.snapshots.push(snapshot);
  }

  async findLatestUsable(reservationId: string, evidence: SnapshotEvidenceSource) {
    const candidates = this.snapshots
      .filter((s) => s.reservationId === reservationId && s.evidenceSource === evidence)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0] ?? null;
  }

  async saveIfAbsent(snapshot: NewBookingFeatureSnapshot): Promise<BookingFeatureSnapshot> {
    const existing = this.snapshots.find(
      (s) => s.reservationId === snapshot.reservationId && s.snapshotHash === snapshot.snapshotHash,
    );
    if (existing) return existing;

    const { evidence: _evidence, sourceIngestionBatchId: _batch, ...rest } = snapshot;
    const stored: BookingFeatureSnapshot = {
      ...rest,
      snapshotId: String(this.sequence++),
      createdAt: new Date(),
    };
    this.snapshots.push(stored);
    return stored;
  }

  async findLatestBySnapshot(snapshotId: string): Promise<ModelScore[]> {
    const latest = new Map<string, ModelScore>();
    for (const score of this.results.filter((r) => r.snapshotId === snapshotId)) {
      const current = latest.get(score.modelKey);
      if (!current || score.scoredAt >= current.scoredAt) latest.set(score.modelKey, score);
    }
    return [...latest.values()];
  }

  async findByIdentities(
    snapshotId: string,
    identities: readonly ModelIdentity[],
  ): Promise<ModelScore[]> {
    return this.results.filter(
      (r) =>
        r.snapshotId === snapshotId &&
        identities.some((id) => id.modelKey === r.modelKey && id.modelVersion === r.modelVersion),
    );
  }

  async saveRun(
    run: NewPredictionRun,
    scores: readonly NewModelScore[],
  ): Promise<SavePredictionRunOutcome> {
    if (this.failNextSaveRun) {
      const failure = this.failNextSaveRun;
      this.failNextSaveRun = null;
      throw failure;
    }

    const fresh = scores.filter(
      (score) =>
        !this.results.some(
          (r) =>
            r.snapshotId === score.snapshotId &&
            r.modelKey === score.modelKey &&
            r.modelVersion === score.modelVersion,
        ),
    );

    let createdRunUid: string | null = null;
    if (fresh.length > 0) {
      this.runs.push(run);
      createdRunUid = run.runUid;
      for (const score of fresh) {
        this.results.push({
          ...score,
          resultId: String(this.sequence++),
          predictionRunId: run.runUid,
        });
      }
    }

    const snapshotId = scores[0]?.snapshotId ?? '';
    return {
      createdRunUid,
      scores: await this.findByIdentities(
        snapshotId,
        scores.map((s) => ({ modelKey: s.modelKey, modelVersion: s.modelVersion })),
      ),
    };
  }

  latestScoresForReservation(
    reservationId: string,
    evidence: SnapshotEvidenceSource,
  ): ModelScore[] {
    const snapshotIds = new Set(
      this.snapshots
        .filter((s) => s.reservationId === reservationId && s.evidenceSource === evidence)
        .map((s) => s.snapshotId),
    );
    const latest = new Map<string, ModelScore>();
    for (const score of this.results.filter((r) => snapshotIds.has(r.snapshotId))) {
      const current = latest.get(score.modelKey);
      if (!current || score.scoredAt >= current.scoredAt) latest.set(score.modelKey, score);
    }
    return [...latest.values()].sort((a, b) => a.modelKey.localeCompare(b.modelKey));
  }

  hasSnapshot(reservationId: string, evidence: SnapshotEvidenceSource): boolean {
    return this.snapshots.some(
      (s) => s.reservationId === reservationId && s.evidenceSource === evidence,
    );
  }
}
