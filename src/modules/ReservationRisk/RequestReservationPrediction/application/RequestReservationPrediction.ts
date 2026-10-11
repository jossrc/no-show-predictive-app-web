import { randomUUID } from 'node:crypto';
import type { CachedMlModelCatalog } from '../../../../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { MlPredictionResponse } from '../../../../infrastructure/http/ml/MlContractTypes.js';
import {
  ML_MODEL_KEYS,
  type MlModelKey,
} from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { MlPredictionClient } from '../../../../infrastructure/http/ml/MlPredictionClient.js';
import { MlUnavailableException } from '../../../../infrastructure/http/ml/errors/MlUnavailableException.js';
import type { DataSourceMode } from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { ClientHistoryRepository } from '../../../ClientHistory/Shared/persistence/ClientHistoryRepository.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../Shared/access/LoadAccessibleReservation.js';
import { assembleRiskAssessment } from '../../Shared/calculation/AssembleRiskAssessment.js';
import type { BookingSnapshotResolver } from '../../Shared/calculation/BookingSnapshotResolver.js';
import type {
  FeatureWarning,
  RiskFeaturesBuilder,
} from '../../Shared/calculation/RiskFeaturesBuilder.js';
import { computeSnapshotHash } from '../../Shared/calculation/SnapshotHash.js';
import { toNewModelScore } from '../../Shared/calculation/ToNewModelScore.js';
import { InvalidFeatureSnapshotException } from '../../Shared/errors/InvalidFeatureSnapshotException.js';
import { NotScorableException } from '../../Shared/errors/NotScorableException.js';
import type { BookingFeatureSnapshot } from '../../Shared/models/BookingFeatureSnapshot.js';
import type { ModelScore } from '../../Shared/models/ModelScore.js';
import { notScorableReason } from '../../Shared/models/NotScorableReason.js';
import type { BookingSnapshotRepository } from '../../Shared/persistence/BookingSnapshotRepository.js';
import type { PredictionResultRepository } from '../../Shared/persistence/PredictionResultRepository.js';
import type { RiskLevelPolicy } from '../../Shared/policy/RiskLevelPolicy.js';
import { validateFeatureSnapshot } from '../../Shared/validation/ValidateFeatureSnapshot.js';
import type { RequestReservationPredictionInput } from './input/RequestReservationPredictionInput.js';
import type { RequestReservationPredictionResult } from './result/RequestReservationPredictionResult.js';

export interface RequestReservationPredictionDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly resolver: BookingSnapshotResolver;
  readonly history: ClientHistoryRepository;
  readonly builder: RiskFeaturesBuilder;
  readonly snapshots: BookingSnapshotRepository;
  readonly results: PredictionResultRepository;
  readonly ml: MlPredictionClient;
  readonly modelCatalog: CachedMlModelCatalog;
  readonly policy: RiskLevelPolicy;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

interface ObtainedSnapshot {
  readonly snapshot: BookingFeatureSnapshot;
  readonly created: boolean;
  readonly warnings: readonly FeatureWarning[];
}

/**
 * HU-02 (acción explícita): genera UNA vez la predicción booking_creation de la reserva.
 * 1) valida elegibilidad y snapshot as-of (lecturas cortas); 2) idempotencia por
 * (snapshot, modelo, versión) sin llamar a Python; 3) inferencia FUERA de transacciones;
 * 4) persistencia corta y atómica solo tras validar el contrato. Nunca por paso del tiempo.
 */
export class RequestReservationPrediction {
  constructor(private readonly deps: RequestReservationPredictionDependencies) {}

  async execute(
    input: RequestReservationPredictionInput,
  ): Promise<RequestReservationPredictionResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    if (reservation.status !== 'SCHEDULED') {
      throw new NotScorableException([notScorableReason('RESERVATION_NOT_SCHEDULED')]);
    }

    const obtained = await this.obtainSnapshot(reservation);
    const keys: readonly MlModelKey[] =
      input.prediction.mode === 'compare' ? ML_MODEL_KEYS : [input.prediction.modelKey];
    const context = { requestId: input.requestId };

    const identities = await Promise.all(
      keys.map(async (modelKey) => {
        const model = await this.deps.modelCatalog.getModel(modelKey, context);
        if (!model) {
          throw new MlUnavailableException({ code: 'ML_MODEL_UNAVAILABLE', operation: 'models' });
        }
        return { modelKey, modelVersion: model.model_version };
      }),
    );

    const existing = await this.deps.results.findByIdentities(
      obtained.snapshot.snapshotId,
      identities,
    );
    const missing = keys.filter((key) => !existing.some((score) => score.modelKey === key));

    if (missing.length === 0) {
      return this.result(obtained, existing, keys, null, true);
    }

    const runRequestedAt = this.deps.clock.now();
    const startedAt = performance.now();
    const responses = await this.infer(missing, obtained.snapshot, input.requestId);
    const mlLatencyMs = performance.now() - startedAt;
    const scoredAt = this.deps.clock.now();

    const expectedVersions = new Map(identities.map((id) => [id.modelKey, id.modelVersion]));
    if (
      responses.some(
        (response) => expectedVersions.get(response.model_key) !== response.model_version,
      )
    ) {
      // El servicio cambió de release: la identidad devuelta prevalece; se refresca el catálogo.
      this.deps.modelCatalog.invalidate();
    }

    const outcome = await this.deps.results.saveRun(
      {
        runUid: randomUUID(),
        snapshotId: obtained.snapshot.snapshotId,
        reservationId: reservation.reservationId,
        mode: missing.length === 2 ? 'compare' : 'single',
        requestedModelKeys: missing,
        requestId: input.requestId,
        runRequestedAt,
        completedAt: scoredAt,
        mlLatencyMs,
      },
      responses.map((response) =>
        toNewModelScore(response, obtained.snapshot, scoredAt, this.deps.policy),
      ),
    );

    return this.result(
      obtained,
      [...existing, ...outcome.scores],
      keys,
      outcome.createdRunUid,
      outcome.createdRunUid === null,
    );
  }

  private async obtainSnapshot(reservation: Reservation): Promise<ObtainedSnapshot> {
    const resolution = await this.deps.resolver.resolve(reservation);

    if (resolution.kind === 'NOT_SCORABLE') throw new NotScorableException(resolution.reasons);
    if (resolution.kind === 'STORED') {
      return { snapshot: resolution.snapshot, created: false, warnings: [] };
    }

    const { verified } = resolution;
    const history = await this.deps.history.summarizeAsOf(verified.clientId, verified.predictionAt);
    const built = this.deps.builder.build(verified, history);
    if (built.kind === 'NOT_SCORABLE') throw new NotScorableException(built.reasons);

    const issues = validateFeatureSnapshot(built.value.features);
    if (issues.length > 0) throw new InvalidFeatureSnapshotException(issues);

    const snapshotHash = computeSnapshotHash({
      reservationId: verified.reservationId,
      predictionAt: verified.predictionAt,
      featureVersion: built.value.featureVersion,
      builderVersion: built.value.featureContext.builder_version,
      features: built.value.features,
    });

    const snapshot = await this.deps.snapshots.saveIfAbsent({
      reservationId: verified.reservationId,
      clientId: verified.clientId,
      snapshotType: 'booking_creation',
      predictionAt: verified.predictionAt,
      appointmentAt: verified.appointmentAt,
      featureVersion: built.value.featureVersion,
      builderVersion: built.value.featureContext.builder_version,
      snapshotHash,
      features: built.value.features,
      evidenceSource: verified.evidenceSource,
      evidence: {
        sources: [
          'analytics.appointment_outcomes',
          'raw_flow.diary_gen',
          'raw_flow.clients',
          'analytics.appointment_services',
          'analytics.product_catalog_resolution',
          'analytics.ml_history_cumulative_v1',
        ],
        historyCutoffExclusive: history.cutoffAt.toISOString(),
        historyLatestKnownAt: history.latestKnownAt?.toISOString() ?? null,
        serviceLines: verified.scheduledServices.length,
        warnings: built.value.warnings,
      },
      sourceIngestionBatchId: resolution.sourceIngestionBatchId,
    });

    return { snapshot, created: true, warnings: built.value.warnings };
  }

  /** Dos modelos ⇒ compare (sin fallback a uno solo); un modelo ⇒ predict de ese modelo. */
  private async infer(
    keys: readonly MlModelKey[],
    snapshot: BookingFeatureSnapshot,
    requestId: string,
  ): Promise<MlPredictionResponse[]> {
    const request = {
      feature_version: snapshot.featureVersion,
      feature_context: {
        snapshot_type: 'booking_creation' as const,
        builder_version: snapshot.builderVersion,
      },
      features: snapshot.features,
    };

    const [onlyKey] = keys;
    if (keys.length === 1 && onlyKey) {
      return [await this.deps.ml.predict({ ...request, model_key: onlyKey }, { requestId })];
    }

    const compared = await this.deps.ml.compare(request, { requestId });
    return [...compared.results];
  }

  private result(
    obtained: ObtainedSnapshot,
    scores: readonly ModelScore[],
    keys: readonly MlModelKey[],
    predictionRunId: string | null,
    replayed: boolean,
  ): RequestReservationPredictionResult {
    return {
      assessment: assembleRiskAssessment({
        reservationId: obtained.snapshot.reservationId,
        snapshot: obtained.snapshot,
        scores: scores.filter((score) => keys.includes(score.modelKey)),
        reasons: [],
        policy: this.deps.policy,
        mode: this.deps.mode,
      }),
      run: {
        predictionRunId,
        replayed,
        requestedModelKeys: keys,
        snapshotCreated: obtained.created,
      },
      featureWarnings: obtained.warnings,
    };
  }
}
