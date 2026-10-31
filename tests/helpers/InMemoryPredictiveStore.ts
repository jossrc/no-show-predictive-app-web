import type { SnapshotEvidenceSource } from '../../src/shared/data/DataSourceMode.js';
import type {
  BookingFeatureSnapshot,
  NewBookingFeatureSnapshot,
} from '../../src/modules/ReservationRisk/Shared/models/BookingFeatureSnapshot.js';
import { summarizeExperimentalRisk } from '../../src/modules/ReservationRisk/Shared/models/ExperimentalRisk.js';
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
import type { ReservationScoreSummary } from '../../src/modules/Reservations/Shared/models/ReservationScoreSummary.js';
import type {
  ExperimentalPolicyIdentity,
  RankedScore,
  ReservationScoreReader,
  ScoreRankingCriteria,
} from '../../src/modules/Reservations/Shared/persistence/ReservationScoreReader.js';

const policyKey = (score: { experimentalRisk: { policyHash: string } | null }) =>
  score.experimentalRisk?.policyHash ?? '';

/**
 * Almacén predictivo en memoria con las mismas reglas UNIQUE/inmutabilidad que el SQLite local
 * (incluida la identidad por política research). Las pruebas de integración SQLite verifican la
 * misma semántica sobre el adaptador real.
 */
export class InMemoryPredictiveStore
  implements BookingSnapshotRepository, PredictionResultRepository, ReservationScoreReader
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
        identities.some(
          (id) =>
            id.modelKey === r.modelKey &&
            id.modelVersion === r.modelVersion &&
            (id.researchPolicyHash ?? '') === policyKey(r),
        ),
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
            r.modelVersion === score.modelVersion &&
            policyKey(r) === policyKey(score),
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
        scores.map((s) => ({
          modelKey: s.modelKey,
          modelVersion: s.modelVersion,
          researchPolicyHash: s.experimentalRisk?.policyHash ?? null,
        })),
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

  // --- ReservationScoreReader (misma semántica que SqliteReservationScoreReader) ---

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async latestScores(
    reservationIds: readonly string[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlyMap<string, readonly ReservationScoreSummary[]>> {
    return new Map(
      reservationIds.map((id) => [
        id,
        this.latestScoresForReservation(id, evidence).map((s) => ({
          modelKey: s.modelKey,
          modelVersion: s.modelVersion,
          modelHash: s.modelHash,
          probabilityNoShow: s.probabilityNoShow,
          scoredAt: s.scoredAt,
          predictionRunId: s.predictionRunId,
          experimentalRisk: s.experimentalRisk
            ? summarizeExperimentalRisk(s.experimentalRisk)
            : null,
        })),
      ]),
    );
  }

  async reservationsWithUsableSnapshot(
    reservationIds: readonly string[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlySet<string>> {
    return new Set(reservationIds.filter((id) => this.hasSnapshot(id, evidence)));
  }

  async rankLatest(criteria: ScoreRankingCriteria): Promise<readonly RankedScore[]> {
    const reservationIds = new Set(
      this.snapshots
        .filter((s) => s.evidenceSource === criteria.evidence)
        .map((s) => s.reservationId),
    );
    return [...reservationIds].flatMap((reservationId) => {
      const latest = this.latestScoresForReservation(reservationId, criteria.evidence).find(
        (s) => s.modelKey === criteria.modelKey,
      );
      if (!latest) return [];
      const p = latest.probabilityNoShow;
      const range = criteria.probabilityRange;
      if (range && !(p >= range.minInclusive && p < range.maxExclusive)) return [];
      if (
        criteria.experimentalPolicyHash !== null &&
        policyKey(latest) !== criteria.experimentalPolicyHash
      ) {
        return [];
      }
      if (
        criteria.experimentalRiskLevel !== null &&
        latest.experimentalRisk?.level !== criteria.experimentalRiskLevel
      ) {
        return [];
      }
      return [{ reservationId, probability: p }];
    });
  }

  async currentExperimentalPolicy(
    modelKey: ModelScore['modelKey'],
    evidence: SnapshotEvidenceSource,
  ): Promise<ExperimentalPolicyIdentity | null> {
    const snapshotIds = new Set(
      this.snapshots.filter((s) => s.evidenceSource === evidence).map((s) => s.snapshotId),
    );
    const latest = this.results
      .filter((r) => r.modelKey === modelKey && r.experimentalRisk && snapshotIds.has(r.snapshotId))
      .sort(
        (a, b) =>
          b.scoredAt.getTime() - a.scoredAt.getTime() || Number(b.resultId) - Number(a.resultId),
      )[0];
    return latest?.experimentalRisk
      ? {
          policyId: latest.experimentalRisk.policyId,
          policyVersion: latest.experimentalRisk.policyVersion,
          policyHash: latest.experimentalRisk.policyHash,
        }
      : null;
  }
}
