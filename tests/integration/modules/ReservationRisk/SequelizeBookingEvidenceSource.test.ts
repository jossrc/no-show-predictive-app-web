import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { Sequelize } from 'sequelize-typescript';
import { SequelizeBookingEvidenceSource } from '../../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import { assessBookingEvidence } from '../../../../src/modules/ReservationRisk/Shared/validation/AssessBookingEvidence.js';
import { IDS, seedReservationScenario } from '../../../fixtures/database/ReservationScenario.js';
import {
  connectPg,
  createTestSequelize,
  probeTestDatabase,
  resetTestDatabase,
} from '../../../helpers/TestDatabase.js';
import { reportSkipped } from '../../../helpers/ReportSkipped.js';

const skip = await probeTestDatabase();

describe(
  'SequelizeBookingEvidenceSource (réplica raw_flow/analytics, solo lectura)',
  { skip: skip ?? false },
  () => {
    let sequelize: Sequelize;
    let client: pg.Client;
    let source: SequelizeBookingEvidenceSource;

    before(async () => {
      await resetTestDatabase();
      client = await connectPg();
      await seedReservationScenario(client);
      sequelize = createTestSequelize();
      source = new SequelizeBookingEvidenceSource(sequelize, 5000);
    });
    after(async () => {
      await sequelize?.close();
      await client?.end();
    });

    it('carga hechos con horas de pared Lima, servicios del ETL y marcas de catálogo/cliente', async () => {
      const evidence = await source.load(IDS.r1);
      assert.ok(evidence);
      assert.equal(evidence.bookingCreatedAt?.toISOString(), '2026-10-20T16:00:00.000Z');
      assert.equal(evidence.appointmentAt.toISOString(), '2026-11-12T15:00:00.000Z');
      assert.equal(evidence.appointmentEndAt?.toISOString(), '2026-11-12T15:40:00.000Z');
      assert.equal(evidence.fwaFlag, -1);
      assert.deepEqual(evidence.client, {
        birthDate: '1998-03-15',
        sex: 'F',
        lastModifiedAt: new Date('2026-01-05T14:00:00Z'),
      });
      assert.equal(evidence.services.length, 1);
      assert.deepEqual(
        {
          ...evidence.services[0],
          catalogLastModifiedAt: evidence.services[0]!.catalogLastModifiedAt.map((d) =>
            d?.toISOString(),
          ),
        },
        {
          sourceDetailId: '900000000003001',
          productId: '900101',
          productType: 1,
          bodyAreaProductId: '101',
          isMedicalEvaluation: false,
          productFound: true,
          catalogResolved: true,
          catalogLastModifiedAt: ['2025-06-01T05:00:00.000Z', '2025-01-01T05:00:00.000Z'],
        },
      );
      assert.equal(evidence.servicesTemporalEvidence, 'NONE_CURRENT_REPLICA');
    });

    it('con la réplica actual ninguna reserva es demostrable: motivos tipados por caso', async () => {
      const codes = async (id: string) => {
        const evidence = await source.load(id);
        assert.ok(evidence, id);
        const result = assessBookingEvidence(evidence);
        return result.kind === 'NOT_SCORABLE' ? result.reasons.map((r) => r.code) : [];
      };
      assert.deepEqual(await codes(IDS.r1), ['SCHEDULED_SERVICES_NOT_POINT_IN_TIME']);
      assert.deepEqual(await codes(IDS.r2), [
        'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
        'CLIENT_ATTRIBUTES_NOT_POINT_IN_TIME',
        'CATALOG_NOT_POINT_IN_TIME',
      ]);
      assert.deepEqual(await codes(IDS.rescheduled), [
        'RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT',
        'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
      ]);
      assert.deepEqual(await codes(IDS.noCreated), [
        'MISSING_BOOKING_TIME',
        'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
      ]);
      assert.ok((await codes(IDS.cancelled)).includes('RESERVATION_NOT_SCHEDULED'));
    });

    it('borradores y copias de reprogramación no son reservas evaluables', async () => {
      assert.equal(await source.load(IDS.draft), null);
      assert.equal(await source.load(IDS.rescheduleCopy), null);
      assert.equal(await source.load('123'), null);
    });
  },
);
reportSkipped('SequelizeBookingEvidenceSource', skip);
