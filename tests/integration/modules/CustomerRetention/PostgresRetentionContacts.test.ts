import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PersistenceUnavailableException } from '../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import type { MlResearchPredictionResponse } from '../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { RecordRetentionContact } from '../../../../src/modules/CustomerRetention/RecordRetentionContact/application/RecordRetentionContact.js';
import { PostgresRetentionContactRepository } from '../../../../src/modules/CustomerRetention/Shared/persistence/postgres/PostgresRetentionContactRepository.js';
import { PriorityClientQuery } from '../../../../src/modules/CustomerRetention/Shared/query/PriorityClientQuery.js';
import { PostgresOperationalStatusReader } from '../../../../src/modules/OperationalOptimization/Shared/persistence/postgres/PostgresOperationalStatusReader.js';
import { toNewModelScore } from '../../../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import type { ModelScore } from '../../../../src/modules/ReservationRisk/Shared/models/ModelScore.js';
import { PostgresPredictiveStore } from '../../../../src/modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { PendingValidationRiskLevelPolicy } from '../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { ScoredReservationRepository } from '../../../../src/modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryReservationSource } from '../../../helpers/InMemoryReservationRepository.js';
import { loadMlGolden } from '../../../helpers/LoadFixture.js';
import {
  makeReservation,
  makeStoredSnapshot,
  makeVerifiedSnapshot,
  SYNTHETIC_CLIENT_ID,
} from '../../../helpers/MakeSyntheticReservation.js';
import {
  createIsolatedStoreDatabase,
  type IsolatedStoreDatabase,
} from '../../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';
import { ALL_CLINICS, filters, hoursFromNow, NOW } from '../../../helpers/RetentionTestContext.js';
import { probeTestDatabase } from '../../../helpers/TestDatabase.js';

const skip = await probeTestDatabase();
reportSkipped('PostgresRetentionContacts', skip);

const A = '900000000861001';
const B = '900000000861002';
const MODE = 'READ_ONLY_EXISTING_SCHEDULE' as const;

describe(
  'Acciones de retención sobre PostgreSQL aislado (UNIQUE, FK, inmutabilidad, persistencia)',
  { skip: skip ?? false },
  () => {
    let database: IsolatedStoreDatabase;
    let store: PostgresPredictiveStore;
    const scores = new Map<string, ModelScore>();
    const source = new InMemoryReservationSource();
    const clock = new FixedClock(NOW);

    async function score(reservationId: string): Promise<ModelScore> {
      const {
        snapshotId: _s,
        createdAt: _c,
        ...rest
      } = makeStoredSnapshot({
        verified: makeVerifiedSnapshot({ reservationId }),
      });
      const snapshot = await store.snapshots.saveIfAbsent({
        ...rest,
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
          requestId: 'retention-it',
          runRequestedAt: NOW,
          completedAt: NOW,
          mlLatencyMs: 1,
          scoringApiVersion: 'v2',
        },
        [
          toNewModelScore(
            golden,
            snapshot,
            new Date('2026-11-09Z'),
            new PendingValidationRiskLevelPolicy(),
          ),
        ],
      );
      return saved.scores[0]!;
    }

    function useCases(target: PostgresPredictiveStore) {
      const contacts = new PostgresRetentionContactRepository(target.database);
      const reservations = new ScoredReservationRepository(
        source,
        target.scores,
        new PostgresOperationalStatusReader(target.database),
      );
      return {
        contacts,
        record: new RecordRetentionContact({
          reservations,
          scores: target.scores,
          runs: target.results,
          contacts,
          mode: MODE,
          clock,
        }),
        query: new PriorityClientQuery({
          reservations,
          scores: target.scores,
          contacts,
          mode: MODE,
        }),
      };
    }

    before(async () => {
      database = await createIsolatedStoreDatabase(MODE);
      store = await PostgresPredictiveStore.open(database.runtime, {
        mode: MODE,
        allowPrivilegedRole: false,
      });
      for (const [id, hours] of [
        [A, 24],
        [B, 30],
      ] as const) {
        source.reservations.set(
          id,
          makeReservation({ reservationId: id, appointmentAt: hoursFromNow(hours) }),
        );
        scores.set(id, await score(id));
      }
    });
    after(async () => {
      await store?.close();
      await database?.drop();
    });

    it('10 registros concurrentes ⇒ un único contacto con fecha original, FK por reserva e inmutable', async () => {
      const { record, contacts } = useCases(store);
      const request = {
        reservationId: A,
        clientId: SYNTHETIC_CLIENT_ID,
        modelKey: 'xgboost_full_v1' as const,
        predictionRunId: scores.get(A)!.predictionRunId,
        clinicScope: ALL_CLINICS,
        requestId: 'retention-it',
      };
      const results = await Promise.all(Array.from({ length: 10 }, () => record.execute(request)));
      assert.equal(results.filter((result) => !result.replayed).length, 1);
      assert.equal(new Set(results.map((result) => result.contact.contactId)).size, 1);

      clock.advanceMs(60_000);
      const retry = await record.execute(request);
      assert.equal(retry.replayed, true);
      assert.equal(retry.contact.contactedAt.toISOString(), NOW.toISOString());
      assert.equal(retry.contact.predictionResultId, scores.get(A)!.resultId);

      // La FK compuesta impide sustentar el contacto con la predicción de OTRA reserva.
      const other = scores.get(A)!;
      await assert.rejects(
        contacts.insertIfAbsent({
          reservationId: B,
          clientId: SYNTHETIC_CLIENT_ID,
          clinicId: 1,
          appointmentAt: hoursFromNow(30),
          retentionStatus: 'CAMPAIGN_SENT',
          contactedAt: NOW,
          requestId: 'fk',
          actorKind: 'INTERNAL_SERVICE',
          actorUserId: null,
          predictionRunId: other.predictionRunId,
          predictionResultId: other.resultId,
          modelKey: other.modelKey,
          modelVersion: other.modelVersion,
          researchPolicyHash: other.experimentalRisk!.policyHash,
          researchPolicyVersion: other.experimentalRisk!.policyVersion,
          riskBandAtContact: 'HIGH',
          probabilityNoShowAtContact: other.probabilityNoShow,
          scoredAt: other.scoredAt,
          eligibilityRuleVersion: 'retention_priority_v1',
        }),
        (error: unknown) =>
          error instanceof PersistenceUnavailableException &&
          error.metadata?.reason === 'INTEGRITY_VIOLATION',
      );
      const admin = await database.connect('admin');
      try {
        await assert.rejects(
          admin.query(`UPDATE ml.app_retention_contacts SET contacted_at = now()`),
          /inmutables/,
        );
      } finally {
        await admin.end();
      }
    });

    it('el estado persiste: una conexión nueva (reinicio) lista CAMPAIGN_SENT y PENDING por reserva', async () => {
      const restarted = await PostgresPredictiveStore.open(database.runtime, {
        mode: MODE,
        allowPrivilegedRole: false,
      });
      try {
        const { query } = useCases(restarted);
        const resolved = await query.resolve(filters(), clock.now());
        const page = await query.page(resolved, null, 10);
        assert.deepEqual(
          page.items.map((item) => [item.reservation.reservationId, item.retentionStatus]),
          [
            [A, 'CAMPAIGN_SENT'],
            [B, 'PENDING'],
          ],
        );
        assert.equal(page.items[0]?.contact?.contactedAt.toISOString(), NOW.toISOString());

        const sent = await query.page(
          await query.resolve(filters({ retentionStatus: 'CAMPAIGN_SENT' }), clock.now()),
          null,
          10,
        );
        assert.deepEqual(
          sent.items.map((item) => item.reservation.reservationId),
          [A],
        );
      } finally {
        await restarted.close();
      }
    });
  },
);
