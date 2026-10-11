/**
 * Demo manual Sprint 01 (SOLO BD de prueba aislada, docker-compose.test.yml):
 *   npm run test:db:up && npm run demo:seed-synthetic
 * Recrea raw_flow/analytics/ml SINTÉTICOS en depi_noshow_test y captura snapshots de demo.
 * La guarda de TestDatabase impide ejecutarlo contra la base real.
 */
import { IDS, seedReservationScenario } from '../fixtures/database/ReservationScenario.js';
import { captureSyntheticSnapshots } from '../fixtures/database/SyntheticDemoSeed.js';
import {
  connectPg,
  createTestSequelize,
  resetTestDatabase,
  testDatabaseConfig,
} from '../helpers/TestDatabase.js';

const config = testDatabaseConfig();
await resetTestDatabase();
const client = await connectPg();
await seedReservationScenario(client);
await client.end();

const sequelize = createTestSequelize();
const snapshots = await captureSyntheticSnapshots(sequelize, [IDS.r1, IDS.r2, IDS.unsafe]);
await sequelize.close();

console.log(
  JSON.stringify(
    {
      database: `${config.host}:${config.port}/${config.database}`,
      mode: 'SYNTHETIC_DEMO_ONLY',
      reservationsWithSnapshot: snapshots.map((snapshot) => snapshot.reservationId),
      otherReservations: [IDS.rescheduled, IDS.noCreated, IDS.cancelled],
    },
    null,
    2,
  ),
);
