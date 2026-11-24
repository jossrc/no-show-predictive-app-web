import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PersistenceUnavailableException } from '../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import type { MlResearchPredictionResponse } from '../../../../src/infrastructure/http/ml/MlContractTypes.js';
import type { NewOverbookingAuthorization } from '../../../../src/modules/OperationalOptimization/Shared/models/OperationalRecords.js';
import { PostgresAttendanceOutcomeRepository } from '../../../../src/modules/OperationalOptimization/Shared/persistence/postgres/PostgresAttendanceOutcomeRepository.js';
import { PostgresOperationalStatusReader } from '../../../../src/modules/OperationalOptimization/Shared/persistence/postgres/PostgresOperationalStatusReader.js';
import { PostgresOverbookingAuthorizationRepository } from '../../../../src/modules/OperationalOptimization/Shared/persistence/postgres/PostgresOverbookingAuthorizationRepository.js';
import { PostgresSpaceRecoveryOutcomeRepository } from '../../../../src/modules/OperationalOptimization/Shared/persistence/postgres/PostgresSpaceRecoveryOutcomeRepository.js';
import { toNewModelScore } from '../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import type { ModelScore } from '../../../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import { PostgresPredictiveStore } from '../../../../src/modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { loadMlGolden } from '../../../helpers/LoadFixture.js';
import {
  makeStoredSnapshot,
  makeVerifiedSnapshot,
} from '../../../helpers/MakeSyntheticReservation.js';
import {
  createIsolatedStoreDatabase,
  type IsolatedStoreDatabase,
} from '../../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';
import { probeTestDatabase } from '../../../helpers/TestDatabase.js';

const skip = await probeTestDatabase();
reportSkipped('PostgresOperationalRepositories', skip);
const A = '900000000301001';
const B = '900000000301002';
const APPOINTMENT = new Date('2026-11-12T20:00:00.000Z');

describe(
  'Repositorios HU-06/07/08 sobre ml.app_* (FK, UNIQUE, keyset, alcance)',
  { skip: skip ?? false },
  () => {
    let database: IsolatedStoreDatabase;
    let store: PostgresPredictiveStore;
    let authorizations: PostgresOverbookingAuthorizationRepository;
    const scores = new Map<string, ModelScore>();

    async function score(reservationId: string): Promise<ModelScore> {
      const {
        snapshotId: _s,
        createdAt: _c,
        ...rest
      } = makeStoredSnapshot({
        verified: makeVerifiedSnapshot({ reservationId, evidenceSource: 'SYNTHETIC_DEMO_ONLY' }),
      });
      const snapshot = await store.snapshots.saveIfAbsent({
        ...rest,
        evidenceSource: 'SYNTHETIC_DEMO_ONLY',
        evidence: {},
        sourceIngestionBatchId: null,
      });
      const golden = loadMlGolden<MlResearchPredictionResponse>('golden_v2_predict_xgb');
      const saved = await store.results.saveRun(
        {
          runUid: randomUUID(),
          snapshotId: snapshot.snapshotId,
          reservationId,
          mode: 'single',
          requestedModelKeys: ['xgboost_full_v1'],
          requestId: 'repo',
          runRequestedAt: new Date(),
          completedAt: new Date(),
          mlLatencyMs: 1,
          scoringApiVersion: 'v2',
        },
        [
          toNewModelScore(
            golden,
            snapshot,
            new Date('2026-10-24Z'),
            new PendingValidationRiskLevelPolicy(),
          ),
        ],
      );
      return saved.scores[0]!;
    }

    function authorizationFor(
      reservationId: string,
      from: ModelScore,
      clinicId = 1,
    ): NewOverbookingAuthorization {
      return {
        reservationId,
        clinicId,
        appointmentAt: APPOINTMENT,
        status: 'ENABLED',
        enabledAt: new Date('2026-10-25Z'),
        requestId: 'repo',
        actorKind: 'INTERNAL_SERVICE',
        actorUserId: null,
        predictionRunId: from.predictionRunId,
        predictionResultId: from.resultId,
        modelKey: from.modelKey,
        modelVersion: from.modelVersion,
        researchPolicyHash: from.experimentalRisk!.policyHash,
        researchPolicyVersion: from.experimentalRisk!.policyVersion,
        riskBandAtAuthorization: 'HIGH',
        probabilityNoShowAtAuthorization: from.probabilityNoShow,
        scoredAt: from.scoredAt,
        eligibilityRuleVersion: 'overbooking_eligibility_v1',
      };
    }

    before(async () => {
      database = await createIsolatedStoreDatabase('SYNTHETIC_DEMO_ONLY');
      store = await PostgresPredictiveStore.open(database.runtime, {
        mode: 'SYNTHETIC_DEMO_ONLY',
        allowPrivilegedRole: false,
      });
      authorizations = new PostgresOverbookingAuthorizationRepository(store.database);
      scores.set(A, await score(A));
      scores.set(B, await score(B));
    });
    after(async () => {
      await store?.close();
      await database?.drop();
    });

    it('la FK compuesta impide vincular la marca a la predicción de OTRA reserva', async () => {
      await assert.rejects(
        authorizations.insertIfAbsent(authorizationFor(A, scores.get(B)!)),
        (error: unknown) =>
          error instanceof PersistenceUnavailableException &&
          error.metadata?.reason === 'INTEGRITY_VIOLATION',
      );
      assert.equal(await authorizations.findByReservation(A), null);
    });

    it('6 INSERT concurrentes ⇒ 1 fila (ON CONFLICT DO NOTHING) y el ganador es estable', async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () =>
          authorizations.insertIfAbsent(authorizationFor(A, scores.get(A)!)),
        ),
      );
      assert.equal(outcomes.filter((o) => o.created).length, 1);
      assert.equal(new Set(outcomes.map((o) => o.record.authorizationId)).size, 1);
      assert.equal(
        outcomes[0]?.record.probabilityNoShowAtAuthorization,
        scores.get(A)!.probabilityNoShow,
      );
    });

    it('HU-08: recuperación solo con autorización existente (FK) y única por autorización', async () => {
      const recoveries = new PostgresSpaceRecoveryOutcomeRepository(store.database);
      const base = {
        reservationId: B,
        clinicId: 1,
        appointmentAt: APPOINTMENT,
        spaceRecovered: false,
        recordedAt: new Date('2026-11-13Z'),
        requestId: 'repo',
        actorKind: 'INTERNAL_SERVICE' as const,
        actorUserId: null,
      };
      const existing = (await authorizations.findByReservation(A))!;
      await assert.rejects(
        recoveries.insertIfAbsent({ ...base, authorizationId: existing.authorizationId }),
        (error: unknown) =>
          error instanceof PersistenceUnavailableException &&
          error.metadata?.reason === 'INTEGRITY_VIOLATION',
        'autorización de otra reserva',
      );
      const created = await recoveries.insertIfAbsent({
        ...base,
        reservationId: A,
        authorizationId: existing.authorizationId,
      });
      assert.deepEqual([created.created, created.record.spaceRecovered], [true, false]);
      const again = await recoveries.insertIfAbsent({
        ...base,
        reservationId: A,
        authorizationId: existing.authorizationId,
        spaceRecovered: true,
      });
      assert.deepEqual(
        [again.created, again.record.spaceRecovered],
        [false, false],
        'no se sobrescribe',
      );
    });

    it('HU-07: observación + comparaciones en una transacción; la comparación con un resultado ajeno revierte todo', async () => {
      const attendance = new PostgresAttendanceOutcomeRepository(store.database);
      const own = scores.get(B)!;
      const foreign = scores.get(A)!;
      const outcome = {
        reservationId: B,
        clinicId: 1,
        appointmentAt: APPOINTMENT,
        appointmentEndAt: null,
        sourceReservationStatus: 'PAST' as const,
        attendanceStatus: 'NO_SHOW' as const,
        observedNoShow: true,
        recordedAt: new Date('2026-11-13Z'),
        requestId: 'repo',
        actorKind: 'INTERNAL_SERVICE' as const,
        actorUserId: null,
        predictionRunId: own.predictionRunId,
        finishedRuleVersion: 'appointment_finished_rule_v1',
      };
      const comparison = (from: ModelScore) => ({
        predictionResultId: from.resultId,
        modelKey: from.modelKey,
        modelVersion: from.modelVersion,
        probabilityNoShow: from.probabilityNoShow,
        scoredAt: from.scoredAt,
        experimentalRiskLevel: from.experimentalRisk?.level ?? null,
        researchPolicyHash: from.experimentalRisk?.policyHash ?? null,
        comparisonRuleVersion: 'binary_outcome_threshold_v1',
        threshold: 0.5,
        predictedNoShow: from.probabilityNoShow >= 0.5,
        observedNoShow: true,
        matchesPrediction: from.probabilityNoShow >= 0.5,
      });
      await assert.rejects(
        attendance.insertIfAbsent({ ...outcome, comparisons: [comparison(foreign)] }),
        PersistenceUnavailableException,
      );
      assert.equal(
        await attendance.findByReservation(B),
        null,
        'ROLLBACK: sin observación huérfana',
      );
      const created = await attendance.insertIfAbsent({
        ...outcome,
        comparisons: [comparison(own)],
      });
      assert.deepEqual([created.created, created.record.comparisons.length], [true, 1]);
      // CHECK: la coincidencia guardada debe ser coherente con el umbral y lo observado.
      const admin = await database.connect('admin');
      try {
        await assert.rejects(
          admin.query(
            `INSERT INTO ml.app_attendance_prediction_comparisons (attendance_outcome_id, reservation_id, prediction_run_id,
             prediction_result_id, model_key, model_version, probability_no_show, scored_at, comparison_rule_version,
             threshold, predicted_no_show, observed_no_show, matches_prediction)
           SELECT c.attendance_outcome_id, c.reservation_id, c.prediction_run_id, c.prediction_result_id, 'random_forest_full_v1',
                  c.model_version, 0.49, c.scored_at, c.comparison_rule_version, 0.5, true, true, true
           FROM ml.app_attendance_prediction_comparisons c LIMIT 1`,
          ),
          (error: { code?: string }) => error.code === '23514' || error.code === '23503',
        );
      } finally {
        await admin.end();
      }
    });

    it('lector de estado por lote y listado con alcance de sede y keyset', async () => {
      const statuses = await new PostgresOperationalStatusReader(store.database).statusesFor([
        A,
        B,
        '1',
      ]);
      assert.equal(statuses.get(A)?.overbooking?.modelKey, 'xgboost_full_v1');
      assert.equal(statuses.get(A)?.spaceRecoveryOutcome?.spaceRecovered, false);
      assert.equal(statuses.get(B)?.attendanceOutcome?.attendanceStatus, 'NO_SHOW');
      assert.equal(statuses.get(B)?.overbooking, null);
      assert.equal(statuses.get('1'), undefined);

      const window = {
        startInclusive: new Date('2026-11-01Z'),
        endExclusive: new Date('2026-12-01Z'),
        clinicId: null,
        after: null,
        limit: 10,
      };
      assert.equal(
        (await authorizations.list({ ...window, clinicScope: { kind: 'ALL_CLINICS' } })).rows
          .length,
        1,
      );
      assert.equal(
        (await authorizations.list({ ...window, clinicScope: { kind: 'CLINICS', clinicIds: [2] } }))
          .rows.length,
        0,
      );
      assert.equal(
        (
          await authorizations.list({
            ...window,
            clinicScope: { kind: 'ALL_CLINICS' },
            after: { appointmentAt: APPOINTMENT, reservationId: A },
          })
        ).rows.length,
        0,
        'keyset estricto (appointmentAt, reservationId)',
      );
    });
  },
);
