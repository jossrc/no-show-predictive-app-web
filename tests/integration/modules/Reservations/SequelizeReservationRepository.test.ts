import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { runInReadOnlySnapshot } from '../../../../src/infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import { SqlitePredictiveStore } from '../../../../src/modules/ReservationRisk/Shared/persistence/sqlite/SqlitePredictiveStore.js';
import type { ReservationListCriteria } from '../../../../src/modules/Reservations/Shared/persistence/ReservationRepository.js';
import { ScoredReservationRepository } from '../../../../src/modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import { SequelizeReservationRepository } from '../../../../src/modules/Reservations/Shared/persistence/sequelize/SequelizeReservationRepository.js';
import { limaDayRangeToInstants } from '../../../../src/shared/time/LimaTime.js';
import { IDS, seedReservationScenario } from '../../../fixtures/database/ReservationScenario.js';
import {
  makeStoredSnapshot,
  makeVerifiedSnapshot,
} from '../../../helpers/MakeSyntheticReservation.js';
import {
  connectPg,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../../helpers/TestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';

const skip = await probeTestDatabase();
const november = limaDayRangeToInstants(
  { year: 2026, month: 11, day: 1 },
  { year: 2026, month: 11, day: 30 },
);

function criteria(overrides: Partial<ReservationListCriteria> = {}): ReservationListCriteria {
  return {
    ...november,
    status: 'SCHEDULED',
    clinicId: null,
    clinicScope: { kind: 'ALL_CLINICS' },
    sortField: 'appointmentAt',
    sortDirection: 'asc',
    modelKey: 'random_forest_full_v1',
    probabilityRange: null,
    experimentalPolicyHash: null,
    experimentalRiskLevel: null,
    snapshotEvidence: 'SYNTHETIC_DEMO_ONLY',
    after: null,
    limit: 25,
    ...overrides,
  };
}

async function scoreReservation(
  store: SqlitePredictiveStore,
  reservationId: string,
  probability: number,
): Promise<void> {
  const snapshots = store.snapshots;
  const stored = makeStoredSnapshot({
    verified: makeVerifiedSnapshot({ reservationId, evidenceSource: 'SYNTHETIC_DEMO_ONLY' }),
    evidenceSource: 'SYNTHETIC_DEMO_ONLY',
  });
  const { snapshotId: _s, createdAt: _c, ...rest } = stored;
  const snapshot = await snapshots.saveIfAbsent({
    ...rest,
    evidence: {},
    sourceIngestionBatchId: null,
  });
  await store.results.saveRun(
    {
      runUid: crypto.randomUUID(),
      snapshotId: snapshot.snapshotId,
      reservationId,
      mode: 'single',
      requestedModelKeys: ['random_forest_full_v1'],
      requestId: 'seed',
      runRequestedAt: new Date(),
      completedAt: new Date(),
      mlLatencyMs: 1,
      scoringApiVersion: 'v1',
    },
    [
      {
        snapshotId: snapshot.snapshotId,
        modelKey: 'random_forest_full_v1',
        algorithm: 'random_forest',
        modelVersion: 'random_forest_full_v1:4e3c86a17005',
        modelHash: '4e3c86a17005',
        featureVersion: 'BOOKING_BASELINE_V1',
        predictionAt: snapshot.predictionAt,
        scoredAt: new Date(),
        probabilityNoShow: probability,
        predictionTarget: 'NO_SHOW_CANDIDATE',
        validationStatus: 'EXPLORATORY_NOT_VALIDATED',
        calibrationStatus: 'not_operationally_validated',
        operationalUseAllowed: false,
        riskLevel: null,
        riskPolicyVersion: null,
        riskPolicyStatus: 'pending_validation',
        scoringApiVersion: 'v1',
        modelHashSha256: null,
        experimentalRisk: null,
      },
    ],
  );
}

/**
 * Fuente PostgreSQL (BD de PRUEBA) compuesta con el almacén SQLite local, igual que en runtime:
 * filtros/orden de negocio en SQL de solo lectura, scores desde el almacén local.
 */
describe('SequelizeReservationRepository (SQL real, BD de prueba)', { skip: skip ?? false }, () => {
  let sequelize: Sequelize;
  let client: pg.Client;
  let repository: ScoredReservationRepository;
  const store = SqlitePredictiveStore.open({ path: ':memory:', mode: 'SYNTHETIC_DEMO_ONLY' });
  const statements: string[] = [];

  before(async () => {
    await resetTestDatabase();
    client = await connectPg();
    await seedReservationScenario(client);
    sequelize = createTestSequelize({ logging: (sql) => void statements.push(sql) });
    repository = new ScoredReservationRepository(
      new SequelizeReservationRepository(sequelize, 5000),
      store.scores,
    );
  });
  after(async () => {
    store.close();
    await sequelize?.close();
    await client?.end();
  });

  it('solo citas FUTURE del período Lima: excluye canceladas, borradores, copias, pasadas y fuera de rango', async () => {
    const page = await repository.list(criteria());
    assert.deepEqual(
      page.rows.map((r) => r.reservation.reservationId),
      [IDS.r1, IDS.r2, IDS.rescheduled, IDS.noCreated, IDS.unsafe],
    );
    assert.equal(page.predictiveStoreAvailable, true);
    const unsafe = page.rows.find((r) => r.reservation.reservationId === IDS.unsafe)!;
    assert.equal(unsafe.reservation.reservationId, '9007199254740993', 'BIGINT sin redondeo');
    assert.equal(
      unsafe.reservation.appointmentAt.toISOString(),
      '2026-12-01T04:30:00.000Z',
      '23:30 Lima del 30-nov',
    );
    assert.equal(
      page.rows.find((r) => r.reservation.reservationId === IDS.rescheduled)!.reservation
        .hasRescheduleEvent,
      true,
    );
    assert.equal(page.rows[0]!.reservation.hasRescheduleEvent, false);
    assert.equal(
      page.rows.find((r) => r.reservation.reservationId === IDS.noCreated)!.reservation
        .bookingCreatedAt,
      null,
    );
  });

  it('canceladas futuras, filtro por sede y alcance de sedes', async () => {
    assert.deepEqual(
      (await repository.list(criteria({ status: 'CANCELLED' }))).rows.map(
        (r) => r.reservation.reservationId,
      ),
      [IDS.cancelled],
    );
    assert.deepEqual(
      (await repository.list(criteria({ clinicId: 2 }))).rows.map(
        (r) => r.reservation.reservationId,
      ),
      [IDS.r2, IDS.noCreated],
    );
    assert.deepEqual(
      (
        await repository.list(criteria({ clinicScope: { kind: 'CLINICS', clinicIds: [2] } }))
      ).rows.map((r) => r.reservation.reservationId),
      [IDS.r2, IDS.noCreated],
    );
  });

  it('una sola consulta de datos por listado, independiente del número de filas (sin N+1)', async () => {
    statements.length = 0;
    await repository.list(criteria({ limit: 1 }));
    const smallPage = statements.filter((sql) =>
      /FROM analytics\.appointment_outcomes/.test(sql),
    ).length;
    statements.length = 0;
    await repository.list(criteria({ limit: 25 }));
    const fullPage = statements.filter((sql) =>
      /FROM analytics\.appointment_outcomes/.test(sql),
    ).length;
    assert.deepEqual([smallPage, fullPage], [1, 1]);
  });

  it('orden por probabilidad NULLS LAST con desempate estable y keyset sin duplicados ni saltos', async () => {
    await scoreReservation(store, IDS.r1, 0.3);
    await scoreReservation(store, IDS.r2, 0.3);
    await scoreReservation(store, IDS.unsafe, 0.9);
    const order: string[] = [];
    let after: ReservationListCriteria['after'] = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await repository.list(
        criteria({ sortField: 'probabilityNoShow', sortDirection: 'desc', limit: 2, after }),
      );
      order.push(...result.rows.map((r) => r.reservation.reservationId));
      const last = result.rows.at(-1);
      if (!result.hasMore || !last) break;
      after = {
        probability: last.sortProbability,
        appointmentAt: last.reservation.appointmentAt,
        reservationId: last.reservation.reservationId,
      };
    }
    assert.deepEqual(order, [IDS.unsafe, IDS.r1, IDS.r2, IDS.rescheduled, IDS.noCreated]);

    const asc = await repository.list(
      criteria({ sortField: 'probabilityNoShow', sortDirection: 'asc' }),
    );
    assert.deepEqual(
      asc.rows.map((r) => r.sortProbability),
      [0.3, 0.3, 0.9, null, null],
    );
    const scored = asc.rows.find((r) => r.reservation.reservationId === IDS.unsafe)!;
    assert.equal(scored.scores[0]!.probabilityNoShow, 0.9);
    assert.equal(scored.hasUsableSnapshot, true);

    const banded = await repository.list(
      criteria({ probabilityRange: { minInclusive: 0.5, maxExclusive: 1.000001 } }),
    );
    assert.deepEqual(
      banded.rows.map((r) => r.reservation.reservationId),
      [IDS.unsafe],
    );

    const realMode = await repository.list(
      criteria({ snapshotEvidence: 'VERIFIED_BOOKING_SNAPSHOT' }),
    );
    assert.ok(
      realMode.rows.every((r) => r.scores.length === 0),
      'snapshots sintéticos invisibles en modo real',
    );
  });

  it('detalle por id, reservas excluidas ⇒ null, sedes existentes', async () => {
    assert.equal(await repository.findById(IDS.draft), null);
    assert.equal(await repository.findById(IDS.rescheduleCopy), null);
    assert.equal((await repository.findById(IDS.past))?.status, 'PAST');
    assert.equal((await repository.findById(IDS.past))?.sourceClassification, null);
    assert.equal(
      (await repository.findWithScores(IDS.unsafe, 'SYNTHETIC_DEMO_ONLY'))?.scores.length,
      1,
    );
    assert.deepEqual(
      [await repository.clinicExists(1), await repository.clinicExists(99)],
      [true, false],
    );
  });

  it('las lecturas fuente son READ ONLY y con statement_timeout efectivo', async () => {
    await assert.rejects(
      runInReadOnlySnapshot(sequelize, { statementTimeoutMs: 5000 }, (transaction) =>
        sequelize.query(`INSERT INTO raw_flow.x_config_clinics ("ClinicID") VALUES (77)`, {
          transaction,
          type: QueryTypes.RAW,
        }),
      ),
      /read-only transaction/,
    );
    await assert.rejects(
      runInReadOnlySnapshot(sequelize, { statementTimeoutMs: 50 }, (transaction) =>
        sequelize.query('SELECT pg_sleep(1)', { transaction, type: QueryTypes.SELECT }),
      ),
      /statement timeout/,
    );
  });

  it('la fuente no depende del schema ml: sin él, listado y orden por score siguen funcionando', async () => {
    await client.query(
      'DROP TABLE ml.prediction_model_results, ml.prediction_runs, ml.booking_feature_snapshots',
    );
    statements.length = 0;
    const page = await repository.list(
      criteria({ sortField: 'probabilityNoShow', sortDirection: 'desc' }),
    );
    assert.equal(page.predictiveStoreAvailable, true);
    assert.equal(page.rows.length, 5);
    assert.equal(page.rows[0]?.reservation.reservationId, IDS.unsafe, 'scores del almacén local');
    assert.ok(
      statements.every((sql) => !/\bml\./.test(sql)),
      'ninguna sentencia toca ml.*',
    );
  });
});
reportSkipped('SequelizeReservationRepository', skip);
