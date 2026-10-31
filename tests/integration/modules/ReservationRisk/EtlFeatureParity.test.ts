import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { Sequelize } from 'sequelize-typescript';
import { PREDICTOR_COLUMNS } from '../../../../src/infrastructure/http/ml/MlFeatureContract.js';
import { SequelizeClientHistoryRepository } from '../../../../src/modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js';
import { RiskFeaturesBuilder } from '../../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import type { BookingEvidence } from '../../../../src/modules/ReservationRisk/Shared/models/BookingEvidence.js';
import type { VerifiedBookingSnapshot } from '../../../../src/modules/ReservationRisk/Shared/models/VerifiedBookingSnapshot.js';
import { SequelizeBookingEvidenceSource } from '../../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import {
  insertAppointment,
  insertClient,
  insertClinics,
  insertProduct,
  insertScheduledService,
} from '../../../fixtures/database/SyntheticDataset.js';
import { fixturePath } from '../../../helpers/LoadFixture.js';
import {
  connectPg,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../../helpers/TestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';

/**
 * Paridad Node ↔ ETL de entrenamiento: ejecuta los scripts REALES del proyecto
 * (docs/init/13_ml_history_cumulative_v1.sql y 14_appointment_training_dataset_v1.sql) sobre
 * datos sintéticos en la BD de prueba y compara las 19 predictoras con RiskFeaturesBuilder.
 * docs/ no se versiona: si los scripts no están en el checkout, la prueba se informa como SKIP.
 */
const ROOT = path.resolve(fixturePath('.'), '..');
const ETL13 = path.join(ROOT, 'docs/init/13_ml_history_cumulative_v1.sql');
const ETL14 = path.join(ROOT, 'docs/init/14_appointment_training_dataset_v1.sql');
const skip =
  (await probeTestDatabase()) ??
  (existsSync(ETL13) && existsSync(ETL14)
    ? null
    : 'SKIP: scripts ETL 13/14 no presentes en docs/init');

reportSkipped('EtlFeatureParity', skip);
const C = '900000000004001';
const D = '900000000004002';

/** Solo para paridad: usa la réplica sin exigir evidencia temporal (citas históricas). */
function toSnapshotForParity(evidence: BookingEvidence): VerifiedBookingSnapshot {
  assert.ok(evidence.bookingCreatedAt && evidence.client);
  return {
    reservationId: evidence.reservationId,
    clientId: evidence.clientId,
    clinicId: evidence.clinicId,
    predictionAt: evidence.bookingCreatedAt,
    appointmentAt: evidence.appointmentAt,
    appointmentEndAt: evidence.appointmentEndAt,
    fwaFlag: evidence.fwaFlag,
    clientBirthDate: evidence.client.birthDate,
    clientSex: evidence.client.sex,
    scheduledServices: evidence.services,
    evidenceSource: 'SYNTHETIC_DEMO_ONLY',
  };
}

async function seedHistoricalScenario(client: pg.Client): Promise<void> {
  await insertClinics(client, [1]);
  await insertClient(client, {
    id: C,
    birthDate: '1990-07-10',
    sex: 'F',
    stampLocal: '2025-01-01 00:00:00',
  });
  await insertClient(client, {
    id: D,
    birthDate: '2008-01-01',
    sex: 'M',
    stampLocal: '2025-01-01 00:00:00',
  });
  await insertProduct(client, { id: '101', type: 0, stampLocal: '2025-01-01 00:00:00' });
  await insertProduct(client, { id: '102', type: 0, stampLocal: '2025-01-01 00:00:00' });
  await insertProduct(client, {
    id: '900101',
    type: 1,
    parentId: '101',
    stampLocal: '2025-01-01 00:00:00',
    bodyAreaProductId: '101',
    resolution: 'SERVICE_PARENT',
  });
  await insertProduct(client, {
    id: '900104',
    type: 4,
    parentId: '102',
    evaluation: -1,
    stampLocal: '2025-01-01 00:00:00',
    bodyAreaProductId: '102',
    resolution: 'SERVICE_PARENT',
  });

  const rows: Array<[string, string, string, string, string, string, string, string, number]> = [
    // id, client, date, start, end, createdLocal, outcome, detail, fwa
    [
      '900000000004101',
      C,
      '2026-01-10',
      '10:00:00',
      '10:30:00',
      '2026-01-02 09:00:00',
      'ATTENDED_COMPLETED',
      'ATTENDED',
      0,
    ],
    [
      '900000000004102',
      C,
      '2026-02-15',
      '16:00:00',
      '16:45:00',
      '2026-02-01 10:00:00',
      'NO_SHOW',
      'NO_SHOW_CANDIDATE',
      -1,
    ],
    [
      '900000000004103',
      C,
      '2026-03-20',
      '09:00:00',
      '10:00:00',
      '2026-02-10 12:00:00',
      'NO_SHOW',
      'NO_SHOW_CANDIDATE',
      0,
    ],
    [
      '900000000004104',
      C,
      '2026-05-05',
      '18:30:00',
      '19:00:00',
      '2026-04-01 08:00:00',
      'ATTENDED_COMPLETED',
      'ATTENDED',
      -1,
    ],
    [
      '900000000004105',
      D,
      '2026-03-01',
      '11:00:00',
      '11:20:00',
      '2026-02-20 10:00:00',
      'CANCELLED',
      'CANCELLED_OR_UNCLASSIFIED',
      0,
    ],
    [
      '900000000004106',
      D,
      '2026-04-10',
      '07:00:00',
      '07:20:00',
      '2026-03-05 23:30:00',
      'ATTENDED_COMPLETED',
      'ATTENDED',
      0,
    ],
  ];
  for (const [id, clientId, date, start, end, createdLocal, outcome, detail, fwa] of rows) {
    await insertAppointment(client, {
      id,
      clientId,
      clinicId: 1,
      date,
      start,
      end,
      createdLocal,
      outcome,
      detail,
      fwa,
    });
    await insertScheduledService(client, {
      appointmentId: id,
      detailId: `${id}1`,
      productId: '900101',
      productType: 1,
      medical: false,
    });
  }
  await insertScheduledService(client, {
    appointmentId: '900000000004103',
    detailId: '9000000000041032',
    productId: '900104',
    productType: 4,
    medical: true,
  });

  // Cierre de sesión (asistencia conocida) y resolución de no-show, tal como los usa el ETL 13.
  const closes: Array<[string, string, string]> = [
    ['900000000004101', '700001', '2026-01-10 11:30:00'],
    ['900000000004104', '700004', '2026-05-05 19:45:00'],
    ['900000000004106', '700006', '2026-04-10 08:00:00'],
  ];
  for (const [appointmentId, laserId, closeLocal] of closes) {
    await client.query(
      `INSERT INTO raw_flow.laser_gen ("LaserGID", "LaserGClientID", "LaserGCloseDate") SELECT $1, client_id, $2::timestamp FROM analytics.appointment_outcomes WHERE appointment_id = $3`,
      [laserId, closeLocal, appointmentId],
    );
    await client.query(
      `UPDATE analytics.appointment_outcomes SET diary_laser_id = $1, ticket_closed_raw = -1 WHERE appointment_id = $2`,
      [laserId, appointmentId],
    );
  }
  await client.query(
    `UPDATE analytics.appointment_outcomes SET outcome_resolved_at = appointment_at + interval '2 hours' WHERE outcome = 'NO_SHOW'`,
  );
  await client.query(
    `UPDATE analytics.appointment_outcomes SET outcome_resolved_at = appointment_at - interval '1 day' WHERE outcome = 'CANCELLED'`,
  );
  // ETL 01 clasifica el origen del tracking; en la fixture: usuario positivo (no UID -1).
  await client.query(`UPDATE analytics.appointment_outcomes SET tracking_origin = 'USER_POSITIVE'`);
}

describe(
  'Paridad de las 19 predictoras con el ETL 14 de entrenamiento',
  { skip: skip ?? false },
  () => {
    let client: pg.Client;
    let sequelize: Sequelize;

    before(async () => {
      await resetTestDatabase();
      client = await connectPg();
      await seedHistoricalScenario(client);
      await client.query(readFileSync(ETL13, 'utf8'));
      await client.query(readFileSync(ETL14, 'utf8'));
      sequelize = createTestSequelize();
    });
    after(async () => {
      await sequelize?.close();
      await client?.end();
    });

    it('cancelaciones no generan eventos de historial (no-show ≠ cancelación)', async () => {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM analytics.ml_history_cumulative_v1 WHERE appointment_id = '900000000004105'`,
      );
      assert.equal(result.rows[0].n, 0);
    });

    it('RiskFeaturesBuilder reproduce las 19 variables del dataset de entrenamiento (tolerancia 1e-9)', async () => {
      const training = await client.query(
        `SELECT appointment_id::text AS id, ${PREDICTOR_COLUMNS.join(', ')} FROM analytics.appointment_training_dataset_v1 ORDER BY appointment_id`,
      );
      assert.equal(
        training.rows.length,
        5,
        'atendidas/no-show con servicios (la cancelada no entra)',
      );

      const evidenceSource = new SequelizeBookingEvidenceSource(sequelize, 5000);
      const history = new SequelizeClientHistoryRepository(sequelize, 5000);
      const builder = new RiskFeaturesBuilder();

      for (const row of training.rows as Array<Record<string, unknown>>) {
        const evidence = await evidenceSource.load(String(row.id));
        assert.ok(evidence, String(row.id));
        const snapshot = toSnapshotForParity(evidence);
        const built = builder.build(
          snapshot,
          await history.summarizeAsOf(snapshot.clientId, snapshot.predictionAt),
        );
        assert.equal(built.kind, 'BUILT', String(row.id));
        if (built.kind !== 'BUILT') continue;

        for (const column of PREDICTOR_COLUMNS) {
          const expected: unknown =
            row[column] === null
              ? null
              : typeof row[column] === 'string' && column !== 'client_sex'
                ? Number(row[column])
                : row[column];
          const actual: unknown = built.value.features[column];
          if (typeof expected === 'number' && typeof actual === 'number') {
            assert.ok(
              Math.abs(actual - expected) < 1e-9,
              `${row.id}.${column}: ${actual} vs ${expected}`,
            );
          } else {
            assert.deepEqual(actual, expected, `${row.id}.${column}`);
          }
        }
      }
    });

    it('caso as-of crítico: la cita creada ANTES de resolverse el no-show previo no lo cuenta', async () => {
      const row =
        await client.query(`SELECT previous_no_show, previous_attended, days_since_previous_attended, distinct_body_areas, has_type4_service, has_medical_evaluation
      FROM analytics.appointment_training_dataset_v1 WHERE appointment_id = '900000000004103'`);
      assert.deepEqual(row.rows[0], {
        previous_no_show: 0,
        previous_attended: 1,
        days_since_previous_attended: row.rows[0].days_since_previous_attended,
        distinct_body_areas: 2,
        has_type4_service: true,
        has_medical_evaluation: true,
      });
      assert.ok(row.rows[0].days_since_previous_attended > 31);
    });
  },
);
