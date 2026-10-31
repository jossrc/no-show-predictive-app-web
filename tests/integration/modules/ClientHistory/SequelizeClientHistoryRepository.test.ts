import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { Sequelize } from 'sequelize-typescript';
import { SequelizeClientHistoryRepository } from '../../../../src/modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js';
import { IDS, seedReservationScenario } from '../../../fixtures/database/ReservationScenario.js';
import {
  connectPg,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../../helpers/TestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';

const skip = await probeTestDatabase();
const CREATION = new Date('2026-10-20T16:00:00Z');

describe(
  'SequelizeClientHistoryRepository (as-of known_at < corte)',
  { skip: skip ?? false },
  () => {
    let sequelize: Sequelize;
    let client: pg.Client;
    let repository: SequelizeClientHistoryRepository;

    before(async () => {
      await resetTestDatabase();
      client = await connectPg();
      await seedReservationScenario(client);
      sequelize = createTestSequelize();
      repository = new SequelizeClientHistoryRepository(sequelize, 5000);
    });
    after(async () => {
      await sequelize?.close();
      await client?.end();
    });

    it('incluye el evento 1 s antes, excluye el evento EXACTAMENTE en la creación y los posteriores', async () => {
      const summary = await repository.summarizeAsOf(IDS.clientA, CREATION);
      assert.deepEqual([summary.previousAttended, summary.previousNoShow], [1, 1]);
      assert.equal(summary.lastNoShowAt?.toISOString(), '2026-10-20T15:59:59.000Z');
      assert.equal(summary.lastAttendedAt?.toISOString(), '2026-03-01T15:00:00.000Z');
      assert.equal(summary.latestKnownAt?.toISOString(), '2026-10-20T15:59:59.000Z');
    });

    it('dos clientes con eventos intercalados no se mezclan; cliente sin historia ⇒ ceros', async () => {
      const other = await repository.summarizeAsOf(IDS.clientB, CREATION);
      assert.deepEqual([other.previousAttended, other.previousNoShow], [0, 1]);
      const empty = await repository.summarizeAsOf(IDS.unsafe, CREATION);
      assert.deepEqual(
        [empty.previousAttended, empty.previousNoShow, empty.lastNoShowAt, empty.latestKnownAt],
        [0, 0, null, null],
      );
    });

    it('consulta en 2027 de una reserva de 2026 solo ve lo conocido antes del corte; current_known ve más', async () => {
      const later = await repository.summarizeAsOf(IDS.clientA, new Date('2027-01-15T00:00:00Z'));
      assert.deepEqual([later.previousAttended, later.previousNoShow], [2, 2]);
      assert.deepEqual(
        [(await repository.summarizeAsOf(IDS.clientA, CREATION)).previousNoShow],
        [1],
        'el corte de la reserva no depende del momento de la consulta',
      );
    });

    it('usa el índice (client_id, known_at DESC, appointment_id DESC) — plan con LIMIT 1', async () => {
      await client.query('ANALYZE analytics.ml_history_cumulative_v1');
      await client.query('SET enable_seqscan = off');
      const plan = await client.query(
        `EXPLAIN SELECT 1 FROM analytics.ml_history_cumulative_v1 h
      WHERE h.client_id = $1 AND h.known_at < $2 ORDER BY h.known_at DESC, h.appointment_id DESC LIMIT 1`,
        [IDS.clientA, CREATION],
      );
      await client.query('SET enable_seqscan = on');
      assert.match(
        plan.rows.map((r) => r['QUERY PLAN']).join('\n'),
        /idx_ml_history_client_known_at/,
      );
    });
  },
);
reportSkipped('SequelizeClientHistoryRepository', skip);
