/**
 * Dataset ESTRICTAMENTE SINTÉTICO y versionado para DATA_SOURCE_MODE=SYNTHETIC_DEMO_ONLY.
 * No contiene personas reales: IDs en el rango 9000000001xxxxx (inexistentes en FLOWww), fechas
 * artificiales y atributos inventados. Nunca se escribe en PostgreSQL ni se mezcla con la réplica.
 *
 * Las reservas puntuables reproducen, a través del RiskFeaturesBuilder real, exactamente las 19
 * predictoras de los ejemplos públicos de depi-noshow-ml (examples/prediction_compare.json y
 * research_risk_synthetic_cases.json), cuyas bandas experimentales Python publicó. Node no fija
 * ningún resultado: el score y la banda los devuelve Python en cada POST.
 */
export const SYNTHETIC_DEMO_DATASET_VERSION = 'synthetic_demo_v1';

export interface SyntheticHistoryEventFixture {
  readonly knownAt: string;
  /** 0 = asistencia completada, 1 = no-show candidato (las cancelaciones no son eventos). */
  readonly kind: 0 | 1;
}

export interface SyntheticReservationFixture {
  readonly reservationId: string;
  readonly clientId: string;
  readonly clinicId: number;
  readonly appointmentAt: string;
  readonly appointmentEndAt: string;
  readonly bookingCreatedAt: string | null;
  readonly status: 'SCHEDULED' | 'CANCELLED';
  readonly sourceClassification: 'FUTURE_PENDING' | 'FUTURE_CANCELLED';
  readonly hasRescheduleEvent: boolean;
  /** DiaryGFWA sintético (-1/0). */
  readonly fwaFlag: number;
  readonly client: { readonly birthDate: string; readonly sex: 'M' | 'F' | 'X' };
  readonly history: readonly SyntheticHistoryEventFixture[];
  /** Ejemplo público de Python cuyas 19 predictoras reproduce (trazabilidad). */
  readonly reproduces: string | null;
}

const DAY_MS = 86_400_000;

function at(iso: string, offsetMs = 0): string {
  return new Date(new Date(iso).getTime() + offsetMs).toISOString();
}

/** n asistencias, la última exactamente `lastDaysBefore` días antes de la reserva. */
function attended(bookingAt: string, count: number, lastDaysBefore: number) {
  return Array.from({ length: count }, (_, index) => ({
    knownAt: at(bookingAt, -(lastDaysBefore + index * 7) * DAY_MS),
    kind: 0 as const,
  }));
}

const CLIENT = { birthDate: '1998-03-15', sex: 'F' } as const;
const CLASSIFICATION_CUTOFF = '2026-10-11T00:00:00.000Z';

function reservation(
  fixture: Omit<
    SyntheticReservationFixture,
    'appointmentEndAt' | 'status' | 'sourceClassification' | 'hasRescheduleEvent' | 'client'
  > &
    Partial<SyntheticReservationFixture>,
): SyntheticReservationFixture {
  return {
    status: 'SCHEDULED',
    sourceClassification: 'FUTURE_PENDING',
    hasRescheduleEvent: false,
    client: CLIENT,
    appointmentEndAt: at(fixture.appointmentAt, 40 * 60_000),
    ...fixture,
  };
}

export const SYNTHETIC_DEMO_CLINICS: readonly number[] = [1, 2, 3];
export const SYNTHETIC_DEMO_CLASSIFICATION_CUTOFF = CLASSIFICATION_CUTOFF;

export const SYNTHETIC_DEMO_RESERVATIONS: readonly SyntheticReservationFixture[] = [
  reservation({
    reservationId: '900000000101001',
    clientId: '900000000201001',
    clinicId: 1,
    appointmentAt: '2026-11-10T20:00:00.000Z',
    bookingCreatedAt: at('2026-11-10T20:00:00.000Z', -0.05 * DAY_MS),
    fwaFlag: 0,
    history: [],
    reproduces: 'research_risk_synthetic_cases.json#synthetic-case-1',
  }),
  reservation({
    reservationId: '900000000101002',
    clientId: '900000000201002',
    clinicId: 1,
    appointmentAt: '2026-11-17T20:00:00.000Z',
    bookingCreatedAt: at('2026-11-17T20:00:00.000Z', -1 * DAY_MS),
    fwaFlag: 0,
    history: [],
    reproduces: 'research_risk_synthetic_cases.json#synthetic-case-2',
  }),
  reservation({
    reservationId: '900000000101003',
    clientId: '900000000201003',
    clinicId: 3,
    appointmentAt: '2026-11-24T20:00:00.000Z',
    bookingCreatedAt: at('2026-11-24T20:00:00.000Z', -10 * DAY_MS),
    fwaFlag: -1,
    history: attended(at('2026-11-24T20:00:00.000Z', -10 * DAY_MS), 10, 30),
    reproduces: 'research_risk_synthetic_cases.json#synthetic-case-3',
  }),
  reservation({
    reservationId: '900000000101004',
    clientId: '900000000201004',
    clinicId: 1,
    appointmentAt: '2026-11-23T13:00:00.000Z',
    bookingCreatedAt: at('2026-11-23T13:00:00.000Z', -0.01 * DAY_MS),
    fwaFlag: 0,
    history: attended(at('2026-11-23T13:00:00.000Z', -0.01 * DAY_MS), 20, 30),
    reproduces: 'research_risk_synthetic_cases.json#synthetic-case-4',
  }),
  reservation({
    reservationId: '900000000101005',
    clientId: '900000000201005',
    clinicId: 1,
    appointmentAt: '2026-11-03T20:00:00.000Z',
    bookingCreatedAt: at('2026-11-03T20:00:00.000Z', -9.5 * DAY_MS),
    fwaFlag: 0,
    history: [
      ...attended(at('2026-11-03T20:00:00.000Z', -9.5 * DAY_MS), 3, 30),
      { knownAt: at('2026-11-03T20:00:00.000Z', -(9.5 + 110) * DAY_MS), kind: 1 },
    ],
    reproduces: 'prediction_compare.json',
  }),
  reservation({
    reservationId: '900000000101006',
    clientId: '900000000201006',
    clinicId: 1,
    appointmentAt: '2026-11-12T15:00:00.000Z',
    bookingCreatedAt: '2026-10-30T15:00:00.000Z',
    hasRescheduleEvent: true,
    fwaFlag: 0,
    history: [],
    reproduces: null,
  }),
  reservation({
    reservationId: '900000000101007',
    clientId: '900000000201007',
    clinicId: 1,
    appointmentAt: '2026-11-13T15:00:00.000Z',
    bookingCreatedAt: '2026-10-30T15:00:00.000Z',
    status: 'CANCELLED',
    sourceClassification: 'FUTURE_CANCELLED',
    fwaFlag: 0,
    history: [],
    reproduces: null,
  }),
  reservation({
    reservationId: '900000000101008',
    clientId: '900000000201008',
    clinicId: 2,
    appointmentAt: '2026-11-14T15:00:00.000Z',
    bookingCreatedAt: null,
    fwaFlag: 0,
    history: [],
    reproduces: null,
  }),
  reservation({
    reservationId: '900000000101009',
    clientId: '900000000201009',
    clinicId: 2,
    appointmentAt: '2026-11-18T16:00:00.000Z',
    bookingCreatedAt: '2026-11-04T16:00:00.000Z',
    fwaFlag: 0,
    history: attended('2026-11-04T16:00:00.000Z', 2, 45),
    reproduces: null,
  }),
];
