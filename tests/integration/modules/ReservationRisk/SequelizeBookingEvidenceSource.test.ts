import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { Sequelize } from 'sequelize-typescript';
import { SequelizeBookingEvidenceSource } from '../../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import { SequelizeReservationRepository } from '../../../../src/modules/Reservations/Shared/persistence/sequelize/SequelizeReservationRepository.js';
import { assessBookingEvidence } from '../../../../src/modules/ReservationRisk/Shared/validation/AssessBookingEvidence.js';
import { IDS, seedReservationScenario } from '../../../fixtures/database/ReservationScenario.js';
import {
  insertAppointment,
  insertScheduledService,
  insertRescheduleEvent,
} from '../../../fixtures/database/SyntheticDataset.js';
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

    it('carga hechos con horas de pared Lima, servicios del ETL y marcas de cliente', async () => {
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
      assert.deepEqual(evidence.services[0], {
        sourceDetailId: '900000000003001',
        productId: '900101',
        productType: 1,
        bodyAreaProductId: '101',
        isMedicalEvaluation: false,
        productFound: true,
        catalogResolved: true,
      });
      assert.equal(evidence.servicesTemporalEvidence, 'FLOWWW_UNCHANGED_BOOKING');
      assert.deepEqual(evidence.historicalVersions, []);
      assert.equal(assessBookingEvidence(evidence).kind, 'VERIFIED');
    });

    it('sin copias avanza; conserva los motivos independientes de cliente, fecha y estado', async () => {
      const codes = async (id: string) => {
        const evidence = await source.load(id);
        assert.ok(evidence, id);
        const result = assessBookingEvidence(evidence);
        return result.kind === 'NOT_SCORABLE' ? result.reasons.map((r) => r.code) : [];
      };
      assert.deepEqual(await codes(IDS.r1), []);
      assert.deepEqual(await codes(IDS.r2), ['CLIENT_ATTRIBUTES_NOT_POINT_IN_TIME']);
      assert.deepEqual(await codes(IDS.rescheduled), [
        'RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT',
        'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
      ]);
      assert.deepEqual(await codes(IDS.noCreated), ['MISSING_BOOKING_TIME']);
      assert.ok((await codes(IDS.cancelled)).includes('RESERVATION_NOT_SCHEDULED'));
    });

    it('identifica copias por DiaryGDelayedID aunque falte el evento; carga sus diary_det', async () => {
      await insertScheduledService(client, {
        appointmentId: IDS.rescheduled,
        detailId: '900000000003020',
        productId: '900101',
        productType: 1,
        medical: false,
      });
      await insertScheduledService(client, {
        appointmentId: IDS.rescheduleCopy,
        detailId: '900000000003021',
        productId: '900101',
        productType: 1,
        medical: false,
      });
      await client.query('DELETE FROM analytics.appointment_events WHERE appointment_id = $1', [
        IDS.rescheduled,
      ]);
      const evidence = await source.load(IDS.rescheduled);
      assert.ok(evidence);
      assert.equal(evidence.servicesTemporalEvidence, 'NONE_CURRENT_REPLICA');
      assert.equal(evidence.hasRescheduleEvent, true);
      assert.equal(evidence.historicalVersions.length, 1);
      const version = evidence.historicalVersions[0]!;
      assert.equal(version.reservationId, IDS.rescheduleCopy);
      assert.equal(version.originalReservationId, IDS.rescheduled);
      assert.equal(version.scheduleChanged, true);
      assert.equal(version.servicesChanged, false);
      assert.equal(version.services[0]!.sourceDetailId, '900000000003021');
      assert.equal(version.services[0]!.productId, '900101');
      assert.equal(assessBookingEvidence(evidence).kind, 'NOT_SCORABLE');
    });

    it('distingue modificación de servicios sin cambios de horario y no puntúa el estado actual', async () => {
      const id = '900000000001020';
      const copyId = '900000000001021';
      const base = {
        clientId: IDS.clientA,
        clinicId: 1,
        date: '2026-11-12',
        start: '10:00:00',
        end: '10:40:00',
        createdLocal: '2026-10-20 11:00:00',
      };
      await insertAppointment(client, { ...base, id, outcome: 'FUTURE', detail: 'FUTURE_PENDING' });
      await insertAppointment(client, {
        ...base,
        id: copyId,
        outcome: 'RESCHEDULED_HISTORY',
        detail: 'EXCLUDED',
        delayed: -1,
        delayedId: id,
      });
      await insertScheduledService(client, {
        appointmentId: id,
        detailId: '900000000003022',
        productId: '900104',
        productType: 4,
        medical: true,
      });
      // La copia conserva sus servicios en raw_flow aunque el ETL no los materialice.
      await client.query(
        `INSERT INTO raw_flow.diary_det ("DiaryID", "DiaryGID", "DiaryZoneID") VALUES ($1, $2, $3)`,
        ['900000000003023', copyId, '900101'],
      );
      const evidence = await source.load(id);
      assert.ok(evidence);
      assert.equal(evidence.hasRescheduleEvent, false);
      assert.equal(evidence.historicalVersions[0]!.scheduleChanged, false);
      assert.equal(evidence.historicalVersions[0]!.servicesChanged, true);
      const reservation = await new SequelizeReservationRepository(sequelize, 5000).findById(id);
      assert.equal(
        reservation?.hasRescheduleEvent,
        false,
        'copia de servicios no implica cambio de horario',
      );
      const assessment = assessBookingEvidence(evidence);
      assert.equal(assessment.kind, 'NOT_SCORABLE');
      if (assessment.kind === 'NOT_SCORABLE')
        assert.deepEqual(
          assessment.reasons.map((r) => r.code),
          ['SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
        );
    });

    it('un evento contradictorio sin timestamp ni copia impide inferir ausencia de cambios', async () => {
      const id = '900000000001030';
      await insertAppointment(client, {
        id,
        clientId: IDS.clientA,
        clinicId: 1,
        date: '2026-11-12',
        start: '10:00:00',
        end: '10:40:00',
        createdLocal: '2026-10-20 11:00:00',
        outcome: 'FUTURE',
        detail: 'FUTURE_PENDING',
      });
      await insertRescheduleEvent(client, {
        appointmentId: id,
        clientId: IDS.clientA,
        copyId: '900000000001031',
        eventAtUtc: '2026-10-22T15:00:00Z',
      });
      await client.query(
        'UPDATE analytics.appointment_events SET event_at = NULL WHERE appointment_id = $1',
        [id],
      );
      const evidence = await source.load(id);
      assert.ok(evidence);
      assert.equal(evidence.hasRescheduleEvent, true);
      assert.equal(evidence.servicesTemporalEvidence, 'NONE_CURRENT_REPLICA');
      const reservation = await new SequelizeReservationRepository(sequelize, 5000).findById(id);
      assert.equal(
        reservation?.hasRescheduleEvent,
        true,
        'el listado tampoco ignora eventos sin fecha',
      );
    });

    it('catálogo no resuelto conserva CATALOG_UNRESOLVED sin bloqueo temporal global', async () => {
      await insertScheduledService(client, {
        appointmentId: IDS.r1,
        detailId: '900000000003040',
        productId: '900199',
        productType: null,
        medical: null,
      });
      const evidence = await source.load(IDS.r1);
      assert.ok(evidence);
      const result = assessBookingEvidence(evidence);
      assert.equal(result.kind, 'NOT_SCORABLE');
      if (result.kind === 'NOT_SCORABLE')
        assert.deepEqual(
          result.reasons.map((r) => r.code),
          ['CATALOG_UNRESOLVED'],
        );
    });

    it('flags raw excluyen cancelación, bloqueo, copia y tag 16 aunque analytics esté desactualizado', async () => {
      for (const [i, column, value] of [
        [0, 'DiaryGNotAttended', -1],
        [1, 'DiaryGLocked', -1],
        [2, 'DiaryGDelayed', -1],
        [3, 'DiaryGTags', '1,16,2'],
      ] as const) {
        const id = `90000000000104${i}`;
        await insertAppointment(client, {
          id,
          clientId: IDS.clientA,
          clinicId: 1,
          date: '2026-11-12',
          start: '10:00:00',
          end: '10:40:00',
          createdLocal: '2026-10-20 11:00:00',
          outcome: 'FUTURE',
          detail: 'FUTURE_PENDING',
        });
        await client.query(`UPDATE raw_flow.diary_gen SET "${column}" = $1 WHERE "DiaryGID" = $2`, [
          value,
          id,
        ]);
        const evidence = await source.load(id);
        if (i === 0) {
          assert.ok(evidence);
          assert.equal(evidence.reservationStatus, 'CANCELLED');
          assert.equal(assessBookingEvidence(evidence).kind, 'NOT_SCORABLE');
        } else assert.equal(evidence, null);
      }
    });

    it('borradores y copias de reprogramación no son reservas evaluables', async () => {
      assert.equal(await source.load(IDS.draft), null);
      assert.equal(await source.load(IDS.rescheduleCopy), null);
      assert.equal(await source.load('123'), null);
    });
  },
);
reportSkipped('SequelizeBookingEvidenceSource', skip);
