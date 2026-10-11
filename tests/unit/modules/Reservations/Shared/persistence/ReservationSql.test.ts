import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReservationListCriteria } from '../../../../../../src/modules/Reservations/Shared/persistence/ReservationRepository.js';
import {
  buildReservationByIdQuery,
  buildReservationListQuery,
} from '../../../../../../src/modules/Reservations/Shared/persistence/sequelize/ReservationSql.js';

const criteria: ReservationListCriteria = {
  startInclusive: new Date('2026-11-01T05:00:00Z'),
  endExclusive: new Date('2026-12-01T05:00:00Z'),
  status: 'SCHEDULED',
  clinicId: 3,
  clinicScope: { kind: 'CLINICS', clinicIds: [3] },
  sortField: 'probabilityNoShow',
  sortDirection: 'desc',
  modelKey: 'random_forest_full_v1',
  probabilityRange: { minInclusive: 0.5, maxExclusive: 1 },
  snapshotEvidence: 'VERIFIED_BOOKING_SNAPSHOT',
  after: {
    probability: 0.7,
    appointmentAt: new Date('2026-11-02T15:00:00Z'),
    reservationId: '900000000001001',
  },
  limit: 25,
};

function maxPlaceholder(sql: string): number {
  return Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
}

describe('ReservationSql (SQL parametrizado con whitelist fija)', () => {
  it('todos los valores viajan como parámetros; el texto SQL no contiene datos del usuario', () => {
    const query = buildReservationListQuery(criteria, true);
    assert.equal(maxPlaceholder(query.sql), query.bind.length);
    for (const value of [
      '900000000001001',
      'random_forest_full_v1',
      'VERIFIED_BOOKING_SNAPSHOT',
      '0.7',
    ]) {
      assert.ok(!query.sql.includes(value), value);
    }
    assert.match(query.sql, /NULLS LAST/);
    assert.match(query.sql, /LIMIT \$\d+/);
    assert.ok(query.bind.includes(26), 'limit+1 para detectar página siguiente');
    assert.doesNotMatch(query.sql, /appointment_training_dataset_v1|client_history_current/);
  });

  it('sin almacén predictivo migrado no referencia el schema ml ni envía parámetros sobrantes', () => {
    const query = buildReservationListQuery(
      { ...criteria, probabilityRange: null, after: null },
      false,
    );
    assert.doesNotMatch(query.sql, /\bml\./);
    assert.equal(maxPlaceholder(query.sql), query.bind.length);
  });

  it('orden cronológico usa (appointment_at, appointment_id) en la misma dirección', () => {
    const query = buildReservationListQuery(
      { ...criteria, sortField: 'appointmentAt', sortDirection: 'asc' },
      true,
    );
    assert.match(query.sql, /ORDER BY o\.appointment_at ASC, o\.appointment_id ASC/);
    assert.match(query.sql, /\(o\.appointment_at, o\.appointment_id\) > /);
  });

  it('detalle por id parametrizado con o sin scores', () => {
    const withScores = buildReservationByIdQuery('9007199254740993', {
      includeScores: true,
      evidence: 'SYNTHETIC_DEMO_ONLY',
    });
    assert.deepEqual(withScores.bind, ['9007199254740993', 'SYNTHETIC_DEMO_ONLY']);
    assert.equal(maxPlaceholder(withScores.sql), 2);
    const plain = buildReservationByIdQuery('1', { includeScores: false });
    assert.equal(maxPlaceholder(plain.sql), 1);
  });
});
