import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Sequelize } from 'sequelize-typescript';
import {
  assertReadOnlySql,
  classifyReadOnlySql,
  installReadOnlySqlGuard,
  POSTGRES_READ_ONLY_SESSION_OPTIONS,
  SourceWriteBlockedException,
} from '../../../../src/infrastructure/database/sequelize/postgres/ReadOnlySqlGuard.js';

describe('ReadOnlySqlGuard (PostgreSQL fuente de solo lectura)', () => {
  it('admite lecturas y el control de transacción que emiten Sequelize y RunInReadOnlySnapshot', () => {
    const allowed: Array<[string, 'READ' | 'TRANSACTION_CONTROL']> = [
      ['SELECT 1+1 AS result', 'READ'],
      [
        `WITH page AS (SELECT o.appointment_id FROM analytics.appointment_outcomes o) SELECT * FROM page`,
        'READ',
      ],
      ['SHOW default_transaction_read_only', 'READ'],
      ['EXPLAIN (FORMAT JSON) SELECT 1', 'READ'],
      [
        `SELECT "DiaryGDelayed", 'UPDATE' AS literal FROM raw_flow.diary_gen -- DELETE en comentario`,
        'READ',
      ],
      ['START TRANSACTION;', 'TRANSACTION_CONTROL'],
      ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;', 'TRANSACTION_CONTROL'],
      ['SET TRANSACTION READ ONLY', 'TRANSACTION_CONTROL'],
      ['SET LOCAL statement_timeout = 10000', 'TRANSACTION_CONTROL'],
      ['SET LOCAL jit = off', 'TRANSACTION_CONTROL'],
      ['COMMIT;', 'TRANSACTION_CONTROL'],
      ['ROLLBACK;', 'TRANSACTION_CONTROL'],
      ['SAVEPOINT "sp-1";', 'TRANSACTION_CONTROL'],
    ];
    for (const [sql, expected] of allowed) assert.equal(classifyReadOnlySql(sql), expected, sql);
  });

  it('bloquea DML, DDL, permisos, bloqueos, CTE con DML, multi-sentencia y funciones con efectos', () => {
    const blocked = [
      'INSERT INTO ml.booking_feature_snapshots (reservation_id) VALUES (1)',
      'UPDATE analytics.appointment_outcomes SET outcome = NULL',
      'DELETE FROM raw_flow.clients',
      'MERGE INTO ml.x USING y ON true WHEN MATCHED THEN DELETE',
      'COPY raw_flow.clients FROM STDIN',
      'TRUNCATE raw_flow.diary_gen',
      'CREATE SCHEMA IF NOT EXISTS ml',
      'ALTER TABLE ml.x ADD COLUMN y int',
      'DROP TABLE analytics.appointment_outcomes',
      'GRANT SELECT ON ALL TABLES IN SCHEMA ml TO public',
      'REVOKE ALL ON SCHEMA ml FROM public',
      'WITH gone AS (DELETE FROM ml.x RETURNING 1) SELECT * FROM gone',
      'SELECT * FROM raw_flow.clients FOR UPDATE',
      'SELECT 1 FOR NO KEY UPDATE',
      'SELECT * INTO TEMP copia FROM raw_flow.clients',
      'SELECT 1; DROP TABLE x',
      "SELECT set_config('default_transaction_read_only', 'off', false)",
      "SELECT nextval('ml.seq')",
      'SELECT pg_advisory_lock(1)',
      'EXPLAIN ANALYZE SELECT 1',
      'SET default_transaction_read_only = off',
      'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
      'BEGIN READ WRITE',
      'VACUUM ANALYZE raw_flow.clients',
      'CALL ml.refresh()',
      'DO $$ BEGIN END $$',
      '',
    ];
    for (const sql of blocked) {
      assert.equal(classifyReadOnlySql(sql), 'BLOCKED', sql);
      assert.throws(() => assertReadOnlySql(sql), SourceWriteBlockedException, sql);
    }
  });

  it('la sesión runtime fuerza default_transaction_read_only=on', () => {
    assert.equal(POSTGRES_READ_ONLY_SESSION_OPTIONS, '-c default_transaction_read_only=on');
  });

  it('el guard instalado rechaza la escritura sin enviarla y deja pasar la lectura', async () => {
    const sent: unknown[] = [];
    const fake = { query: async (sql: unknown) => (sent.push(sql), []) } as unknown as Sequelize;
    const guarded = installReadOnlySqlGuard(fake);

    await guarded.query('SELECT 1');
    await guarded.query({ query: 'SELECT $1::int', values: [1] } as unknown as string);
    await assert.rejects(
      () => guarded.query('INSERT INTO ml.prediction_runs DEFAULT VALUES'),
      (error: unknown) =>
        error instanceof SourceWriteBlockedException && error.code === 'SOURCE_WRITE_BLOCKED',
    );
    assert.equal(sent.length, 2);
    assert.throws(() => {
      (guarded as unknown as { query: unknown }).query = async () => [];
    }, TypeError);
  });
});

describe('Todo el SQL runtime de la fuente PostgreSQL pasa el guard de solo lectura', () => {
  it('reservas, evidencia e historial emiten solo lecturas y control de transacción READ ONLY', async () => {
    const { SequelizeReservationRepository } =
      await import('../../../../src/modules/Reservations/Shared/persistence/sequelize/SequelizeReservationRepository.js');
    const { SequelizeBookingEvidenceSource } =
      await import('../../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js');
    const { SequelizeClientHistoryRepository } =
      await import('../../../../src/modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js');
    const sent: string[] = [];
    const fake = {
      query: async (sql: string) => {
        sent.push(sql);
        // Fila de hechos para que la evidencia ejecute también su consulta de servicios.
        return /client_found/.test(sql)
          ? [{ outcome: 'FUTURE', classification_detail: 'FUTURE_PENDING' }]
          : [];
      },
      transaction: async (_options: unknown, work: (t: object) => Promise<unknown>) => work({}),
    } as unknown as Sequelize;
    const sequelize = installReadOnlySqlGuard(fake);

    const source = new SequelizeReservationRepository(sequelize, 1000);
    await source.list({
      startInclusive: new Date('2026-11-01T05:00:00Z'),
      endExclusive: new Date('2026-12-01T05:00:00Z'),
      status: 'SCHEDULED',
      clinicId: 1,
      clinicScope: { kind: 'CLINICS', clinicIds: [1] },
      direction: 'desc',
      onlyIds: ['900000000001001'],
      excludeIds: ['900000000001002'],
      after: { appointmentAt: new Date('2026-11-02T00:00:00Z'), reservationId: '900000000001003' },
      limit: 5,
    });
    await source.findById('900000000001001');
    await source.clinicExists(1);
    await new SequelizeBookingEvidenceSource(sequelize, 1000).load('900000000001001');
    await new SequelizeClientHistoryRepository(sequelize, 1000).summarizeAsOf(
      '900000000002001',
      new Date('2026-10-20T16:00:00Z'),
    );

    assert.ok(sent.length >= 10);
    assert.ok(
      sent.some((sql) => /analytics\.appointment_services/.test(sql)),
      'SQL de servicios cubierto',
    );
    assert.ok(sent.includes('SET TRANSACTION READ ONLY'));
    for (const sql of sent) assert.notEqual(classifyReadOnlySql(sql), 'BLOCKED', sql.slice(0, 80));
    assert.ok(
      sent.every((sql) => !/\bml\./.test(sql)),
      'la fuente runtime no lee el schema ml',
    );
  });
});
