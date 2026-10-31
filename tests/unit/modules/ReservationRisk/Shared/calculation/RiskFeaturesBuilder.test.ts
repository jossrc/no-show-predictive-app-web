import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PREDICTOR_COLUMNS } from '../../../../../../src/infrastructure/http/ml/MlFeatureContract.js';
import {
  RiskFeaturesBuilder,
  type BuiltRiskFeatures,
  type RiskFeaturesBuildResult,
} from '../../../../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { computeSnapshotHash } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/SnapshotHash.js';
import { assessBookingEvidence } from '../../../../../../src/modules/ReservationRisk/Shared/validation/AssessBookingEvidence.js';
import { validateFeatureSnapshot } from '../../../../../../src/modules/ReservationRisk/Shared/validation/ValidateFeatureSnapshot.js';
import { InMemoryClientHistoryRepository } from '../../../../../helpers/InMemoryClientHistoryRepository.js';
import {
  makeBookingEvidence,
  makeHistory,
  makeVerifiedSnapshot,
  SYNTHETIC_CLIENT_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

const builder = new RiskFeaturesBuilder();
const PREDICTION_AT = new Date('2026-10-20T16:00:00.000Z'); // Lima 2026-10-20 11:00

function built(result: RiskFeaturesBuildResult): BuiltRiskFeatures {
  assert.equal(result.kind, 'BUILT', `se esperaba BUILT: ${JSON.stringify(result)}`);
  return (result as { value: BuiltRiskFeatures }).value;
}

function reasonCodes(result: RiskFeaturesBuildResult): string[] {
  assert.equal(result.kind, 'NOT_SCORABLE');
  return (result as { reasons: readonly { code: string }[] }).reasons.map((reason) => reason.code);
}

function build(snapshot = {}, history = {}) {
  return builder.build(
    makeVerifiedSnapshot(snapshot),
    makeHistory({ cutoffAt: PREDICTION_AT, ...history }),
  );
}

describe('RiskFeaturesBuilder (19 predictoras as-of booking_creation)', () => {
  it('01 edad en años cumplidos al RESERVAR, en calendario de Lima (no a la fecha de la cita)', () => {
    // Cumpleaños el 21-oct: el 20-oct (Lima) aún tiene 27; la cita (12-nov) es posterior.
    assert.equal(built(build({ clientBirthDate: '1998-10-21' })).features.age_at_booking, 27);
    const onBirthday = new Date('2026-10-21T15:00:00.000Z');
    assert.equal(
      built(
        build(
          { clientBirthDate: '1998-10-21', predictionAt: onBirthday },
          { cutoffAt: onBirthday },
        ),
      ).features.age_at_booking,
      28,
    );
    // 03:00Z del 21-oct UTC sigue siendo 20-oct 22:00 en Lima.
    const lateLima = new Date('2026-10-21T03:00:00.000Z');
    assert.equal(
      built(
        build({ clientBirthDate: '1998-10-21', predictionAt: lateLima }, { cutoffAt: lateLima }),
      ).features.age_at_booking,
      27,
    );
  });

  it('02 edad fuera de 16–95, nacimiento futuro o desconocido ⇒ null con advertencia', () => {
    const young = built(build({ clientBirthDate: '2011-01-01' }));
    assert.equal(young.features.age_at_booking, null);
    assert.ok(young.warnings.includes('AGE_OUT_OF_MODEL_RANGE'));
    assert.equal(built(build({ clientBirthDate: '1920-01-01' })).features.age_at_booking, null);

    const future = built(build({ clientBirthDate: '2027-01-01' }));
    assert.equal(future.features.age_at_booking, null);
    assert.ok(future.warnings.includes('BIRTH_DATE_AFTER_BOOKING'));

    const unknown = built(build({ clientBirthDate: null }));
    assert.equal(unknown.features.age_at_booking, null);
    assert.ok(unknown.warnings.includes('UNKNOWN_BIRTH_DATE'));
    assert.equal(built(build({ clientBirthDate: '1998-02-30' })).features.age_at_booking, null);
  });

  it('03 sexo M/F/X se conserva; null real y valores inesperados ⇒ null sin normalizar', () => {
    for (const sex of ['M', 'F', 'X']) {
      assert.equal(built(build({ clientSex: sex })).features.client_sex, sex);
    }
    assert.equal(built(build({ clientSex: null })).features.client_sex, null);
    for (const unexpected of ['f', ' F', '', 'O']) {
      const result = built(build({ clientSex: unexpected }));
      assert.equal(result.features.client_sex, null);
      assert.ok(result.warnings.includes('UNEXPECTED_CLIENT_SEX_VALUE'));
    }
  });

  it('04 booking_lead_days exacto en días (segundos/86400); igualdad, negativo, >730 y no finito bloquean', () => {
    const lead = built(build()).features.booking_lead_days;
    assert.equal(lead, (Date.parse('2026-11-12T20:00:00Z') - PREDICTION_AT.getTime()) / 86_400_000);
    assert.ok(Math.abs(lead - 23.1666666667) < 1e-9);

    assert.deepEqual(reasonCodes(build({ appointmentAt: PREDICTION_AT })), [
      'BOOKING_NOT_BEFORE_APPOINTMENT',
    ]);
    assert.ok(
      reasonCodes(build({ appointmentAt: new Date('2026-10-19T16:00:00Z') })).includes(
        'BOOKING_NOT_BEFORE_APPOINTMENT',
      ),
    );
    assert.deepEqual(reasonCodes(build({ appointmentAt: new Date('2028-10-21T16:00:00Z') })), [
      'LEAD_TIME_OUT_OF_TRAINING_RANGE',
    ]);
    assert.deepEqual(reasonCodes(build({ appointmentAt: new Date('invalid') })), [
      'INVALID_SOURCE_VALUE',
    ]);
  });

  it('05 mes/día ISO en Lima al cruzar medianoche UTC, fin de mes y de año (lunes=1, domingo=7)', () => {
    // 2026-11-01T03:30Z = sábado 31-oct 22:30 en Lima.
    const saturday = built(
      build({ appointmentAt: new Date('2026-11-01T03:30:00Z'), appointmentEndAt: null }),
    );
    assert.deepEqual(
      [
        saturday.features.appointment_month,
        saturday.features.appointment_weekday,
        saturday.features.appointment_hour,
      ],
      [10, 6, 22],
    );
    const sunday = built(
      build({ appointmentAt: new Date('2026-11-01T15:00:00Z'), appointmentEndAt: null }),
    );
    assert.equal(sunday.features.appointment_weekday, 7, 'ISO como el ETL 14: nunca 7→0');
    assert.ok(
      sunday.warnings.includes('WEEKDAY_ABSENT_FROM_TRAINING_DATA'),
      'domingo fuera de distribución',
    );
    const monday = built(
      build({ appointmentAt: new Date('2026-11-02T15:00:00Z'), appointmentEndAt: null }),
    );
    assert.equal(monday.features.appointment_weekday, 1);
    assert.ok(!monday.warnings.includes('WEEKDAY_ABSENT_FROM_TRAINING_DATA'));
    assert.ok(!saturday.warnings.includes('WEEKDAY_ABSENT_FROM_TRAINING_DATA'));
    // 2027-01-01T04:00Z = jueves 31-dic-2026 23:00 en Lima.
    const newYearEve = built(
      build({ appointmentAt: new Date('2027-01-01T04:00:00Z'), appointmentEndAt: null }),
    );
    assert.deepEqual(
      [
        newYearEve.features.appointment_month,
        newYearEve.features.appointment_weekday,
        newYearEve.features.appointment_hour,
      ],
      [12, 4, 23],
    );
  });

  it('06 hora 0 y 23 en Lima, segundos ignorados e independiente de la zona horaria del proceso', () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        const midnight = built(
          build({ appointmentAt: new Date('2026-11-12T05:00:59Z'), appointmentEndAt: null }),
        );
        assert.equal(midnight.features.appointment_hour, 0, tz);
        const late = built(
          build({ appointmentAt: new Date('2026-11-13T04:59:59Z'), appointmentEndAt: null }),
        );
        assert.equal(late.features.appointment_hour, 23, tz);
        assert.equal(late.features.appointment_weekday, 4, tz);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('07 duración desde agenda inicio/fin; fin antes de inicio o ausente ⇒ null', () => {
    assert.equal(built(build()).features.duration_minutes, 40);
    const inverted = built(build({ appointmentEndAt: new Date('2026-11-12T19:30:00Z') }));
    assert.equal(inverted.features.duration_minutes, null);
    assert.ok(inverted.warnings.includes('END_BEFORE_START_DURATION_NULL'));
    assert.equal(built(build({ appointmentEndAt: null })).features.duration_minutes, null);
    assert.equal(
      built(build({ appointmentEndAt: new Date('2026-11-12T20:00:00Z') })).features
        .duration_minutes,
      0,
    );
  });

  it('08 is_fwa = DiaryGFWA <> 0 (0, -1, 1) y null desconocido', () => {
    assert.equal(built(build({ fwaFlag: 0 })).features.is_fwa, false);
    assert.equal(built(build({ fwaFlag: -1 })).features.is_fwa, true);
    assert.equal(built(build({ fwaFlag: 1 })).features.is_fwa, true);
    assert.equal(built(build({ fwaFlag: null })).features.is_fwa, null);
  });

  it('09 clinic_id positivo se transmite; fuera de rango seguro JS o no positivo lo rechaza el validador', () => {
    assert.equal(built(build({ clinicId: 17 })).features.clinic_id, 17);
    const unsafe = built(build({ clinicId: Number('9007199254740993') })).features;
    assert.deepEqual(validateFeatureSnapshot(unsafe), [
      { field: 'clinic_id', reason: 'not_safe_integer' },
    ]);
    const zero = built(build({ clinicId: 0 })).features;
    assert.deepEqual(validateFeatureSnapshot(zero), [
      { field: 'clinic_id', reason: 'below_minimum' },
    ]);
  });

  it('10 servicios: cero, una, varias líneas, zona repetida y single_body_area_id coherente', () => {
    const line = (id: string, area: string | null, overrides = {}) => ({
      sourceDetailId: id,
      productId: '900101',
      productType: 1,
      bodyAreaProductId: area,
      isMedicalEvaluation: false,
      ...overrides,
    });

    const none = built(build({ scheduledServices: [] }));
    assert.deepEqual(
      [
        none.features.scheduled_service_lines,
        none.features.distinct_body_areas,
        none.features.single_body_area_id,
      ],
      [0, 0, null],
    );
    assert.equal(none.features.has_medical_evaluation, false);
    assert.ok(none.warnings.includes('ZERO_SCHEDULED_SERVICES_OUT_OF_TRAINING_POPULATION'));

    const repeated = built(
      build({ scheduledServices: [line('1', '101'), line('2', '101')] }),
    ).features;
    assert.deepEqual(
      [
        repeated.scheduled_service_lines,
        repeated.distinct_body_areas,
        repeated.single_body_area_id,
      ],
      [2, 1, 101],
    );

    const two = built(
      build({ scheduledServices: [line('1', '101'), line('2', '202'), line('3', null)] }),
    ).features;
    assert.deepEqual(
      [two.scheduled_service_lines, two.distinct_body_areas, two.single_body_area_id],
      [3, 2, null],
    );

    const medical = built(
      build({
        scheduledServices: [
          line('1', '101'),
          line('2', '101', { isMedicalEvaluation: true, productType: 4 }),
        ],
      }),
    ).features;
    assert.equal(medical.has_medical_evaluation, true);
    assert.equal(medical.has_type4_service, true);
    for (const features of [none.features, repeated, two, medical]) {
      assert.deepEqual(validateFeatureSnapshot(features), []);
    }
  });

  it('11 catálogo sin identificar o resolver ⇒ NOT_SCORABLE; atributo desconocido ⇒ null, nunca false inventado', () => {
    const unresolvedCatalog = assessBookingEvidence(
      makeBookingEvidence({
        services: [
          {
            ...makeBookingEvidence().services[0]!,
            productFound: false,
            catalogResolved: false,
          },
        ],
      }),
    );
    assert.equal(unresolvedCatalog.kind, 'NOT_SCORABLE');

    const unknownType = built(
      build({
        scheduledServices: [
          {
            sourceDetailId: '1',
            productId: null,
            productType: null,
            bodyAreaProductId: null,
            isMedicalEvaluation: null,
          },
        ],
      }),
    ).features;
    assert.equal(unknownType.has_type4_service, null);
    assert.equal(unknownType.has_medical_evaluation, null);
  });

  it('12 cliente nuevo: contadores 0, tasa null y recencias null (nunca 0 inventado)', () => {
    const f = built(build()).features;
    assert.deepEqual(
      [
        f.previous_attended,
        f.previous_no_show,
        f.previous_no_show_rate,
        f.days_since_previous_attended,
        f.days_since_previous_no_show,
      ],
      [0, 0, null, null, null],
    );
  });

  it('13 una asistencia previa: tasa 0 y recencia de asistencia en días', () => {
    const last = new Date('2026-09-20T16:00:00Z');
    const f = built(
      build({}, { previousAttended: 1, lastAttendedAt: last, latestKnownAt: last }),
    ).features;
    assert.equal(f.previous_no_show_rate, 0);
    assert.equal(f.days_since_previous_attended, 30);
    assert.equal(f.days_since_previous_no_show, null);
  });

  it('14 un no-show previo: tasa 1 y recencia de no-show', () => {
    const last = new Date('2026-07-02T16:00:00Z');
    const f = built(
      build({}, { previousNoShow: 1, lastNoShowAt: last, latestKnownAt: last }),
    ).features;
    assert.equal(f.previous_no_show_rate, 1);
    assert.equal(f.days_since_previous_no_show, 110);
    assert.equal(f.days_since_previous_attended, null);
  });

  it('15 historial mixto: tasa exacta no_show/(attended+no_show) con tolerancia flotante', () => {
    const f = built(
      build(
        {},
        {
          previousAttended: 2,
          previousNoShow: 1,
          lastAttendedAt: new Date('2026-09-01T00:00:00Z'),
          lastNoShowAt: new Date('2026-08-01T00:00:00Z'),
          latestKnownAt: new Date('2026-09-01T00:00:00Z'),
        },
      ),
    ).features;
    assert.ok(Math.abs((f.previous_no_show_rate ?? -1) - 1 / 3) < 1e-12);
    assert.deepEqual(validateFeatureSnapshot(f), []);
  });

  it('16 known_at justo antes se incluye; igual o posterior a prediction_at se excluye o bloquea', async () => {
    const repo = new InMemoryClientHistoryRepository();
    const ms = PREDICTION_AT.getTime();
    repo.add(
      { clientId: SYNTHETIC_CLIENT_ID, appointmentId: '1', knownAt: new Date(ms - 1), kind: 1 },
      { clientId: SYNTHETIC_CLIENT_ID, appointmentId: '2', knownAt: new Date(ms), kind: 1 },
      { clientId: SYNTHETIC_CLIENT_ID, appointmentId: '3', knownAt: new Date(ms + 1), kind: 0 },
    );
    const summary = await repo.summarizeAsOf(SYNTHETIC_CLIENT_ID, PREDICTION_AT);
    assert.deepEqual([summary.previousNoShow, summary.previousAttended], [1, 0]);
    assert.equal(
      built(builder.build(makeVerifiedSnapshot(), summary)).features.previous_no_show,
      1,
    );

    // Guardia anti-fuga del builder ante un historial que no respeta el corte.
    assert.deepEqual(
      reasonCodes(
        build({}, { previousNoShow: 1, lastNoShowAt: PREDICTION_AT, latestKnownAt: PREDICTION_AT }),
      ),
      ['HISTORY_NOT_AS_OF'],
    );
    assert.deepEqual(reasonCodes(build({}, { cutoffAt: new Date(ms + 1000) })), [
      'HISTORY_NOT_AS_OF',
    ]);
  });

  it('17 reprogramación sin foto original ⇒ bloqueo as-of (no se usa la fecha/servicios actuales)', () => {
    const assessment = assessBookingEvidence(makeBookingEvidence({ hasRescheduleEvent: true }));
    assert.equal(assessment.kind, 'NOT_SCORABLE');
    assert.deepEqual(
      assessment.kind === 'NOT_SCORABLE' ? assessment.reasons.map((r) => r.code) : [],
      ['RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT'],
    );
  });

  it('18 una cancelación no puede sumarse como no-show: el historial solo admite eventos 0/1 de ml_history', async () => {
    const repo = new InMemoryClientHistoryRepository();
    // El ETL 13 no emite cancelaciones; solo asistencia (0) y no-show candidato (1).
    repo.add({
      clientId: SYNTHETIC_CLIENT_ID,
      appointmentId: '1',
      knownAt: new Date('2026-01-01Z'),
      kind: 0,
    });
    const summary = await repo.summarizeAsOf(SYNTHETIC_CLIENT_ID, PREDICTION_AT);
    const f = built(builder.build(makeVerifiedSnapshot(), summary)).features;
    assert.equal(f.previous_no_show, 0);
    assert.equal(f.previous_no_show_rate, 0);
  });

  it('19 exactamente las 19 claves canónicas en orden, sin target, IDs ni metadatos de reserva', () => {
    const value = built(build());
    assert.deepEqual(Object.keys(value.features), [...PREDICTOR_COLUMNS]);
    for (const forbidden of [
      'target',
      'appointment_id',
      'client_id',
      'reservation_id',
      'prediction_at',
    ]) {
      assert.ok(!(forbidden in value.features), forbidden);
    }
    assert.deepEqual(value.featureContext, {
      snapshot_type: 'booking_creation',
      builder_version: 'risk_features_builder_v1',
    });
    assert.equal(value.featureVersion, 'BOOKING_BASELINE_V1');
  });

  it('20 determinismo: misma evidencia ⇒ mismas features y mismo hash (sin reloj global)', () => {
    const first = built(build());
    const second = built(build());
    assert.deepEqual(first, second);
    const hash = (value: BuiltRiskFeatures) =>
      computeSnapshotHash({
        reservationId: '1',
        predictionAt: PREDICTION_AT,
        featureVersion: value.featureVersion,
        builderVersion: value.featureContext.builder_version,
        features: value.features,
      });
    assert.equal(hash(first), hash(second));
    assert.notEqual(hash(first), hash(built(build({ fwaFlag: -1 }))));
  });

  it('21 NaN, Infinity, strings numéricos y booleanos como número son rechazados', () => {
    const base = built(build()).features as unknown as Record<string, unknown>;
    const cases: Array<[string, unknown, string]> = [
      ['booking_lead_days', Number.NaN, 'not_finite_number'],
      ['booking_lead_days', Number.POSITIVE_INFINITY, 'not_finite_number'],
      ['appointment_hour', '15', 'not_finite_number'],
      ['previous_attended', true, 'not_finite_number'],
      ['is_fwa', 0, 'not_boolean'],
      ['appointment_month', 11.5, 'not_safe_integer'],
    ];
    for (const [field, value, reason] of cases) {
      assert.deepEqual(
        validateFeatureSnapshot({ ...base, [field]: value }),
        [{ field, reason }],
        field,
      );
    }
  });

  it('22 un cambio posterior de la fuente produce otro hash: el snapshot original no se reescribe', () => {
    const original = built(build());
    const changed = built(build({ scheduledServices: [] }));
    const hashOf = (value: BuiltRiskFeatures) =>
      computeSnapshotHash({
        reservationId: '1',
        predictionAt: PREDICTION_AT,
        featureVersion: value.featureVersion,
        builderVersion: value.featureContext.builder_version,
        features: value.features,
      });
    assert.notEqual(hashOf(original), hashOf(changed));
    assert.equal(original.features.scheduled_service_lines, 1);
  });

  it('23 reserva de 2026 consultada en 2027 no usa eventos conocidos en 2027', async () => {
    const repo = new InMemoryClientHistoryRepository();
    repo.add(
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '1',
        knownAt: new Date('2026-05-01Z'),
        kind: 0,
      },
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '2',
        knownAt: new Date('2027-02-01Z'),
        kind: 1,
      },
    );
    // El corte es prediction_at (creación de la reserva), nunca "ahora".
    const summary = await repo.summarizeAsOf(SYNTHETIC_CLIENT_ID, PREDICTION_AT);
    const f = built(builder.build(makeVerifiedSnapshot(), summary)).features;
    assert.deepEqual([f.previous_attended, f.previous_no_show], [1, 0]);
  });

  it('24 dos clientes con eventos intercalados nunca comparten historial', async () => {
    const repo = new InMemoryClientHistoryRepository();
    const other = '900000000002999';
    repo.add(
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '1',
        knownAt: new Date('2026-03-01Z'),
        kind: 0,
      },
      { clientId: other, appointmentId: '2', knownAt: new Date('2026-03-02Z'), kind: 1 },
      { clientId: other, appointmentId: '3', knownAt: new Date('2026-03-03Z'), kind: 1 },
      {
        clientId: SYNTHETIC_CLIENT_ID,
        appointmentId: '4',
        knownAt: new Date('2026-03-04Z'),
        kind: 1,
      },
    );
    const mine = await repo.summarizeAsOf(SYNTHETIC_CLIENT_ID, PREDICTION_AT);
    const theirs = await repo.summarizeAsOf(other, PREDICTION_AT);
    assert.deepEqual([mine.previousAttended, mine.previousNoShow], [1, 1]);
    assert.deepEqual([theirs.previousAttended, theirs.previousNoShow], [0, 2]);
    // El builder rechaza un historial de OTRO cliente.
    assert.deepEqual(reasonCodes(builder.build(makeVerifiedSnapshot(), theirs)), [
      'HISTORY_NOT_AS_OF',
    ]);
  });

  it('contadores incoherentes (recencia sin eventos, negativos) se rechazan como INVALID_SOURCE_VALUE', () => {
    assert.deepEqual(
      reasonCodes(build({}, { previousAttended: 0, lastAttendedAt: new Date('2026-01-01Z') })),
      ['INVALID_SOURCE_VALUE'],
    );
    assert.deepEqual(reasonCodes(build({}, { previousNoShow: -1 })), ['INVALID_SOURCE_VALUE']);
    const noRecency = built(build({}, { previousAttended: 2, lastAttendedAt: null }));
    assert.equal(noRecency.features.days_since_previous_attended, null);
    assert.ok(noRecency.warnings.includes('POSITIVE_COUNT_WITHOUT_RECENCY'));
  });
});
