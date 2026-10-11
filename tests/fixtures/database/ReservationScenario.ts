import type pg from 'pg';
import {
  insertAppointment,
  insertClient,
  insertClinics,
  insertHistoryRow,
  insertProduct,
  insertRescheduleEvent,
  insertScheduledService,
} from './SyntheticDataset.js';

/** Escenario sintético compartido por las pruebas de integración (sin PII real). */
export const IDS = {
  clientA: '900000000002001',
  clientB: '900000000002002',
  r1: '900000000001001',
  r2: '900000000001002',
  cancelled: '900000000001003',
  draft: '900000000001004',
  rescheduleCopy: '900000000001005',
  rescheduled: '900000000001006',
  unsafe: '9007199254740993',
  outside: '900000000001008',
  past: '900000000001009',
  noCreated: '900000000001010',
} as const;

const future = { outcome: 'FUTURE', detail: 'FUTURE_PENDING' };

export async function seedReservationScenario(client: pg.Client): Promise<void> {
  await insertClinics(client, [1, 2]);
  await insertClient(client, {
    id: IDS.clientA,
    birthDate: '1998-03-15',
    sex: 'F',
    stampLocal: '2026-01-05 09:00:00',
  });
  await insertClient(client, {
    id: IDS.clientB,
    birthDate: '1985-12-01',
    sex: 'M',
    stampLocal: '2026-11-01 09:00:00',
  });
  await insertClient(client, {
    id: IDS.unsafe,
    birthDate: null,
    sex: 'F',
    stampLocal: '2025-01-01 00:00:00',
  });

  await insertProduct(client, { id: '101', type: 0, stampLocal: '2025-01-01 00:00:00' });
  await insertProduct(client, {
    id: '900101',
    type: 1,
    parentId: '101',
    stampLocal: '2025-06-01 00:00:00',
    bodyAreaProductId: '101',
    resolution: 'SERVICE_PARENT',
  });
  await insertProduct(client, {
    id: '900104',
    type: 4,
    parentId: '101',
    evaluation: -1,
    stampLocal: '2026-10-25 00:00:00',
    bodyAreaProductId: '101',
    resolution: 'SERVICE_PARENT',
  });

  const base = {
    start: '10:00:00',
    end: '10:40:00',
    createdLocal: '2026-10-20 11:00:00',
    ...future,
  };
  await insertAppointment(client, {
    ...base,
    id: IDS.r1,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-11-12',
    fwa: -1,
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.r2,
    clientId: IDS.clientB,
    clinicId: 2,
    date: '2026-11-12',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.cancelled,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-11-13',
    outcome: 'CANCELLED',
    detail: 'FUTURE_CANCELLED',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.draft,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-11-14',
    outcome: 'DRAFT',
    detail: 'EXCLUDED',
    tags: '16',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.rescheduleCopy,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-11-15',
    outcome: 'RESCHEDULED_HISTORY',
    detail: 'EXCLUDED',
    delayed: -1,
    delayedId: IDS.rescheduled,
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.rescheduled,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-11-20',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.unsafe,
    clientId: IDS.unsafe,
    clinicId: 1,
    date: '2026-11-30',
    start: '23:30:00',
    end: '23:50:00',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.outside,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-12-01',
    start: '00:30:00',
    end: '01:00:00',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.past,
    clientId: IDS.clientA,
    clinicId: 1,
    date: '2026-06-10',
    createdLocal: '2026-06-01 09:00:00',
    outcome: 'ATTENDED_COMPLETED',
    detail: 'ATTENDED',
  });
  await insertAppointment(client, {
    ...base,
    id: IDS.noCreated,
    clientId: IDS.clientB,
    clinicId: 2,
    date: '2026-11-25',
    createdLocal: null,
  });

  await insertScheduledService(client, {
    appointmentId: IDS.r1,
    detailId: '900000000003001',
    productId: '900101',
    productType: 1,
    medical: false,
  });
  await insertScheduledService(client, {
    appointmentId: IDS.r2,
    detailId: '900000000003002',
    productId: '900104',
    productType: 4,
    medical: true,
  });
  await insertRescheduleEvent(client, {
    appointmentId: IDS.rescheduled,
    clientId: IDS.clientA,
    copyId: IDS.rescheduleCopy,
    eventAtUtc: '2026-10-22T15:00:00Z',
  });

  // Historial acumulado (ETL 13) — creación de r1 = 2026-10-20 11:00 Lima = 16:00Z.
  await insertHistoryRow(client, {
    appointmentId: '900000000009001',
    clientId: IDS.clientA,
    knownAtUtc: '2026-03-01T15:00:00Z',
    kind: 0,
    attended: 1,
    noShow: 0,
    lastAttendedUtc: '2026-03-01T15:00:00Z',
    lastNoShowUtc: null,
  });
  await insertHistoryRow(client, {
    appointmentId: '900000000009002',
    clientId: IDS.clientB,
    knownAtUtc: '2026-03-02T00:00:00Z',
    kind: 1,
    attended: 0,
    noShow: 1,
    lastAttendedUtc: null,
    lastNoShowUtc: '2026-03-02T00:00:00Z',
  });
  await insertHistoryRow(client, {
    appointmentId: '900000000009003',
    clientId: IDS.clientA,
    knownAtUtc: '2026-10-20T15:59:59Z',
    kind: 1,
    attended: 1,
    noShow: 1,
    lastAttendedUtc: '2026-03-01T15:00:00Z',
    lastNoShowUtc: '2026-10-20T15:59:59Z',
  });
  await insertHistoryRow(client, {
    appointmentId: '900000000009004',
    clientId: IDS.clientA,
    knownAtUtc: '2026-10-20T16:00:00Z',
    kind: 0,
    attended: 2,
    noShow: 1,
    lastAttendedUtc: '2026-10-20T16:00:00Z',
    lastNoShowUtc: '2026-10-20T15:59:59Z',
  });
  await insertHistoryRow(client, {
    appointmentId: '900000000009005',
    clientId: IDS.clientA,
    knownAtUtc: '2026-11-01T00:00:00Z',
    kind: 1,
    attended: 2,
    noShow: 2,
    lastAttendedUtc: '2026-10-20T16:00:00Z',
    lastNoShowUtc: '2026-11-01T00:00:00Z',
  });
}
