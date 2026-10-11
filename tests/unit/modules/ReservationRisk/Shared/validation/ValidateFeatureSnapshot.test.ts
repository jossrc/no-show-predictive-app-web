import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateFeatureSnapshot } from '../../../../../../src/modules/ReservationRisk/Shared/validation/ValidateFeatureSnapshot.js';
import { loadJsonFixture } from '../../../../../helpers/LoadFixture.js';

const valid = loadJsonFixture<{ request: { features: Record<string, unknown> } }>(
  'fixtures/ml/synthetic_compare_request.json',
).request.features;

describe('ValidateFeatureSnapshot (contrato BOOKING_BASELINE_V1)', () => {
  it('acepta el ejemplo sintético del contrato Python', () => {
    assert.deepEqual(validateFeatureSnapshot(valid), []);
  });

  it('rechaza claves faltantes, undefined y extras (target, IDs)', () => {
    const { age_at_booking: _omit, ...missing } = valid;
    assert.deepEqual(validateFeatureSnapshot(missing), [
      { field: 'age_at_booking', reason: 'missing' },
    ]);
    assert.deepEqual(validateFeatureSnapshot({ ...valid, age_at_booking: undefined }), [
      { field: 'age_at_booking', reason: 'missing' },
    ]);
    assert.deepEqual(validateFeatureSnapshot({ ...valid, target: 1 }), [
      { field: '[extra]', reason: 'unexpected_field' },
    ]);
    assert.deepEqual(validateFeatureSnapshot(null), [{ field: 'features', reason: 'not_object' }]);
    assert.deepEqual(validateFeatureSnapshot([]), [{ field: 'features', reason: 'not_object' }]);
  });

  it('respeta nulabilidad: null permitido solo donde el contrato lo admite', () => {
    assert.deepEqual(validateFeatureSnapshot({ ...valid, booking_lead_days: null }), [
      { field: 'booking_lead_days', reason: 'null_not_allowed' },
    ]);
    assert.deepEqual(validateFeatureSnapshot({ ...valid, age_at_booking: null, is_fwa: null }), []);
  });

  it('aplica rangos del OpenAPI (edad, mes, día ISO, hora, anticipación >0)', () => {
    const cases: Array<[string, unknown, string]> = [
      ['age_at_booking', 15, 'below_minimum'],
      ['age_at_booking', 96, 'above_maximum'],
      ['appointment_month', 13, 'above_maximum'],
      ['appointment_weekday', 0, 'below_minimum'],
      ['appointment_hour', 24, 'above_maximum'],
      ['booking_lead_days', 0, 'below_minimum'],
      ['client_sex', 'm', 'invalid_enum'],
      ['previous_no_show_rate', 1.5, 'above_maximum'],
    ];
    for (const [field, value, reason] of cases) {
      assert.deepEqual(
        validateFeatureSnapshot({ ...valid, [field]: value }),
        [{ field, reason }],
        field,
      );
    }
  });

  it('coherencia cruzada: áreas ≤ líneas, área única ⇔ áreas=1, tasa y recencias', () => {
    assert.deepEqual(
      validateFeatureSnapshot({ ...valid, distinct_body_areas: 2, single_body_area_id: null }),
      [{ field: 'distinct_body_areas', reason: 'exceeds_service_lines' }],
    );
    assert.deepEqual(validateFeatureSnapshot({ ...valid, single_body_area_id: null }), [
      { field: 'single_body_area_id', reason: 'inconsistent_with_distinct_body_areas' },
    ]);
    assert.deepEqual(validateFeatureSnapshot({ ...valid, previous_no_show_rate: 0.3 }), [
      { field: 'previous_no_show_rate', reason: 'inconsistent_ratio' },
    ]);
    assert.deepEqual(validateFeatureSnapshot({ ...valid, previous_no_show_rate: 0.2500005 }), []);
    assert.deepEqual(validateFeatureSnapshot({ ...valid, previous_no_show_rate: null }), [
      { field: 'previous_no_show_rate', reason: 'required_with_history' },
    ]);
    const noHistory = {
      ...valid,
      previous_attended: 0,
      previous_no_show: 0,
      previous_no_show_rate: 0,
      days_since_previous_attended: 3,
      days_since_previous_no_show: null,
    };
    assert.deepEqual(validateFeatureSnapshot(noHistory), [
      { field: 'previous_no_show_rate', reason: 'must_be_null_without_history' },
      { field: 'days_since_previous_attended', reason: 'must_be_null_without_events' },
    ]);
  });
});
