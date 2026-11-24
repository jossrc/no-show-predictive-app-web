import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ImportReservations } from '../../../../src/modules/ReservationImport/ImportReservations/application/ImportReservations.js';
import { PostgresImportedReservationRepository } from '../../../../src/modules/ReservationImport/Shared/persistence/postgres/PostgresImportedReservationRepository.js';
import { PostgresImportedReservationSource } from '../../../../src/modules/ReservationImport/Shared/persistence/postgres/PostgresImportedReservationSource.js';
import { PostgresPredictiveStore } from '../../../../src/modules/ReservationRisk/Shared/persistence/postgres/PostgresPredictiveStore.js';
import { CompositeReservationSource } from '../../../../src/modules/Reservations/Shared/persistence/CompositeReservationSource.js';
import { FakeImportReferenceReader } from '../../../helpers/FakeImportReferenceReader.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryReservationSource } from '../../../helpers/InMemoryReservationRepository.js';
import { makeReservation } from '../../../helpers/MakeSyntheticReservation.js';
import {
  createIsolatedStoreDatabase,
  type IsolatedStoreDatabase,
} from '../../../helpers/PredictiveStoreTestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';
import {
  ALL_CLINICS,
  importInput,
  importRow,
  NOW,
  toCsv,
} from '../../../helpers/RetentionTestContext.js';
import { probeTestDatabase } from '../../../helpers/TestDatabase.js';

const skip = await probeTestDatabase();
reportSkipped('PostgresReservationImport', skip);

const LARGE_ID = '987654321098765432';

describe(
  'Incorporación de reservas sobre PostgreSQL aislado (migración 003, ml.app_*)',
  { skip: skip ?? false },
  () => {
    let database: IsolatedStoreDatabase;
    let store: PostgresPredictiveStore;
    let imported: PostgresImportedReservationRepository;
    const references = new FakeImportReferenceReader();
    references.addClient('900000000702001');

    const importer = (batch: string) =>
      new ImportReservations({
        references,
        imported,
        limits: { maxFileBytes: 1024 * 1024, maxRows: 100 },
        clock: new FixedClock(NOW),
        newBatchId: () => batch,
      });

    async function count(table: string): Promise<number> {
      const admin = await database.connect('admin');
      try {
        const result = await admin.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM ${table}`,
        );
        return Number(result.rows[0]?.total);
      } finally {
        await admin.end();
      }
    }

    before(async () => {
      database = await createIsolatedStoreDatabase('READ_ONLY_EXISTING_SCHEDULE');
      store = await PostgresPredictiveStore.open(database.runtime, {
        mode: 'READ_ONLY_EXISTING_SCHEDULE',
        allowPrivilegedRole: false,
      });
      imported = new PostgresImportedReservationRepository(store.database);
    });
    after(async () => {
      await store?.close();
      await database?.drop();
    });

    it('importaciones concurrentes del mismo archivo: un registro por reserva, lotes trazados e inmutables', async () => {
      assert.equal((await store.health()).schemaVersion, '003');
      const file = toCsv([
        importRow({ DiaryGID: '900000000711001' }),
        importRow({ DiaryGID: LARGE_ID, DiaryZoneIDs: '900101|900101' }),
        importRow({ DiaryGID: '900000000711003', DiaryGClinicID: '77' }),
      ]);
      const [first, second] = await Promise.all([
        importer('00000000-0000-4000-8000-0000000000a1').execute(importInput('a.csv', file)),
        importer('00000000-0000-4000-8000-0000000000a2').execute(importInput('a.csv', file)),
      ]);

      assert.equal(first.batch.acceptedRows + second.batch.acceptedRows, 2);
      assert.deepEqual(
        [
          first.batch.totalRows,
          second.batch.totalRows,
          first.batch.rejectedRows + second.batch.rejectedRows,
        ],
        [3, 3, 4],
      );
      assert.equal(await count('ml.app_imported_reservations'), 2);
      assert.equal(await count('ml.app_reservation_import_batches'), 2);
      assert.equal(await count('ml.app_reservation_import_rejections'), 4);

      const stored = await imported.findByReservationId(LARGE_ID);
      assert.equal(stored?.reservationId, LARGE_ID);
      assert.deepEqual(stored?.serviceProductIds, ['900101', '900101']);
      assert.equal(stored?.appointmentAt.toISOString(), '2026-11-11T15:00:00.000Z');

      const again = await importer('00000000-0000-4000-8000-0000000000a3').execute(
        importInput('a.csv', file),
      );
      assert.equal(again.batch.status, 'NO_ROWS_ACCEPTED');
      assert.equal(await count('ml.app_imported_reservations'), 2);

      // Registros inmutables: UPDATE/DELETE rechazados incluso para el administrador de prueba.
      const admin = await database.connect('admin');
      try {
        for (const statement of [
          `UPDATE ml.app_imported_reservations SET clinic_id = 2`,
          `DELETE FROM ml.app_reservation_import_batches`,
        ]) {
          await assert.rejects(admin.query(statement), /inmutables/, statement);
        }
      } finally {
        await admin.end();
      }
      const runtime = await database.connect('runtime');
      try {
        await assert.rejects(
          runtime.query(`TRUNCATE ml.app_imported_reservations`),
          /permission denied|inmutables/,
        );
      } finally {
        await runtime.end();
      }
    });

    it('las importadas se listan con la semántica de la fuente (filtros y keyset) junto a la principal', async () => {
      const primary = new InMemoryReservationSource();
      primary.reservations.set(
        '900000000001001',
        makeReservation({ appointmentAt: new Date('2026-11-11T15:00:00.000Z') }),
      );
      const source = new CompositeReservationSource(
        primary,
        new PostgresImportedReservationSource(store.database),
        references,
      );
      const criteria = {
        startInclusive: new Date('2026-11-11T05:00:00.000Z'),
        endExclusive: new Date('2026-11-12T05:00:00.000Z'),
        status: 'SCHEDULED' as const,
        clinicId: 1,
        clinicScope: ALL_CLINICS,
        direction: 'asc' as const,
        onlyIds: null,
        excludeIds: null,
      };
      const seen: string[] = [];
      let after: { appointmentAt: Date; reservationId: string } | null = null;
      for (;;) {
        const page = await source.list({ ...criteria, after, limit: 1 });
        seen.push(...page.rows.map((row) => row.reservationId));
        const last = page.rows.at(-1);
        if (!page.hasMore || !last) break;
        after = { appointmentAt: last.appointmentAt, reservationId: last.reservationId };
      }
      assert.deepEqual(seen, ['900000000001001', '900000000711001', LARGE_ID]);
      assert.equal((await source.findById(LARGE_ID))?.origin, 'IMPORT');

      // Si la fuente principal llega a registrar el mismo ID, prevalece y la importada se oculta.
      references.sourceReservationIds.add('900000000711001');
      const shadowed = await source.list({ ...criteria, after: null, limit: 10 });
      assert.deepEqual(
        shadowed.rows.map((row) => row.reservationId),
        ['900000000001001', LARGE_ID],
      );
      assert.equal(await source.findById('900000000711001'), null);
      references.sourceReservationIds.delete('900000000711001');
    });
  },
);
