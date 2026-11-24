import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { additiveMigrationViolations } from '../../../../src/infrastructure/database/postgres/AdditiveMigrationGuard.js';
import { classifyAppStoreSql } from '../../../../src/infrastructure/database/postgres/PredictiveAppSqlGuard.js';
import { fixturePath } from '../../../helpers/LoadFixture.js';

describe('PredictiveAppSqlGuard (conexión escritora de la app: solo SELECT/INSERT en ml.app_*)', () => {
  it('admite lecturas, INSERT propios (incl. ON CONFLICT DO NOTHING) y control de transacción', () => {
    for (const [sql, kind] of [
      ['SELECT 1 AS ok', 'READ'],
      ['WITH x AS (SELECT 1) SELECT * FROM x', 'READ'],
      [
        'INSERT INTO ml.app_overbooking_authorizations (a) VALUES ($1) ON CONFLICT (reservation_id) DO NOTHING RETURNING a',
        'INSERT',
      ],
      [
        'INSERT INTO ml.app_attendance_outcomes (a) SELECT pr.run_id FROM ml.app_prediction_runs pr WHERE pr.run_uid = $1::uuid',
        'INSERT',
      ],
      ['BEGIN', 'TRANSACTION_CONTROL'],
      ['COMMIT', 'TRANSACTION_CONTROL'],
      ["SELECT * FROM ml.app_x WHERE note = 'DELETE FROM x'", 'READ'],
    ] as const) {
      assert.equal(classifyAppStoreSql(sql), kind, sql);
    }
  });

  it('bloquea UPDATE/DELETE/DDL, upsert DO UPDATE, tablas fuente, tablas ajenas, DO y sentencias encadenadas', () => {
    for (const sql of [
      'UPDATE ml.app_prediction_runs SET mode = $1',
      'DELETE FROM ml.app_prediction_runs',
      'TRUNCATE ml.app_prediction_runs',
      'DROP TABLE ml.app_prediction_runs',
      'ALTER TABLE ml.app_prediction_runs ADD COLUMN x int',
      'CREATE TABLE ml.app_x (a int)',
      'INSERT INTO ml.app_x (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2',
      'INSERT INTO ml.prediction_runs (a) VALUES (1)',
      'INSERT INTO raw_flow.clients (a) VALUES (1)',
      'SELECT * FROM raw_flow.diary_gen',
      'SELECT * FROM analytics.appointment_outcomes',
      'WITH d AS (DELETE FROM ml.app_x RETURNING *) SELECT * FROM d',
      'SELECT 1; DELETE FROM ml.app_x',
      'DO $$ BEGIN INSERT INTO ml.app_x VALUES (1); END $$',
      'SELECT set_config($1, $2, false)',
      'SELECT * FROM ml.app_x FOR UPDATE',
      'GRANT SELECT ON ml.app_x TO public',
    ]) {
      assert.equal(classifyAppStoreSql(sql), 'BLOCKED', sql);
    }
  });
});

describe('AdditiveMigrationGuard (migraciones del almacén: solo CREATE de objetos nuevos ml.app_*)', () => {
  it('las migraciones versionadas del repositorio son aditivas', () => {
    const directory = path.resolve(fixturePath('.'), '../migrations/postgres/predictive_app');
    for (const file of ['001_app_predictive_store.sql', '002_app_operational_optimization.sql']) {
      assert.deepEqual(
        additiveMigrationViolations(readFileSync(path.join(directory, file), 'utf8')),
        [],
        file,
      );
    }
  });

  it('rechaza vocabulario destructivo, objetos fuera de ml.app_*, FK ajenas y ocultar colisiones', () => {
    const cases: Array<[string, string]> = [
      ['DROP TABLE ml.app_x;', 'DROP'],
      ['TRUNCATE ml.app_x;', 'TRUNCATE'],
      ['DELETE FROM ml.app_x;', 'DELETE'],
      ['UPDATE ml.app_x SET a = 1;', 'UPDATE'],
      ['ALTER TABLE ml.booking_feature_snapshots ADD COLUMN x int;', 'ALTER'],
      [
        'CREATE OR REPLACE FUNCTION ml.app_f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN END $$;',
        'OR REPLACE',
      ],
      ['CREATE TABLE IF NOT EXISTS ml.app_x (a int);', 'IF [NOT] EXISTS'],
      ['CREATE TABLE ml.prediction_runs (a int);', 'TABLE fuera de ml.app_*'],
      ['CREATE TABLE analytics.x (a int);', 'esquema ajeno'],
      [
        'CREATE TABLE ml.app_x (a bigint REFERENCES ml.prediction_runs (run_id));',
        'FK hacia objeto ajeno',
      ],
      ['CREATE INDEX i ON ml.prediction_runs (a);', 'INDEX fuera de ml.app_*'],
      [
        'CREATE TRIGGER t BEFORE UPDATE ON ml.prediction_runs FOR EACH ROW EXECUTE FUNCTION ml.app_f();',
        'TRIGGER fuera de ml.app_*',
      ],
      ['GRANT SELECT ON ml.app_x TO public;', 'GRANT/REVOKE'],
      ['INSERT INTO ml.app_x VALUES (1);', 'INSERT'],
    ];
    for (const [sql, expected] of cases) {
      assert.ok(additiveMigrationViolations(sql).includes(expected), `${sql} ⇒ ${expected}`);
    }
    assert.deepEqual(
      additiveMigrationViolations(
        "CREATE TABLE ml.app_x (a int CHECK (a > 0)); CREATE TRIGGER t BEFORE UPDATE OR DELETE ON ml.app_x FOR EACH ROW EXECUTE FUNCTION ml.app_prevent_mutation(); COMMENT ON TABLE ml.app_x IS 'texto con DROP y DELETE';",
      ),
      [],
      'los triggers de inmutabilidad y los literales no son vocabulario destructivo',
    );
  });
});
