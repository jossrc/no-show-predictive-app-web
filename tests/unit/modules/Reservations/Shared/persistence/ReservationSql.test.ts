import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyReadOnlySql } from '../../../../../../src/infrastructure/database/sequelize/postgres/ReadOnlySqlGuard.js';
import type { ReservationSourceCriteria } from '../../../../../../src/modules/Reservations/Shared/persistence/ReservationSource.js';
import {
  buildReservationByIdQuery,
  buildReservationListQuery,
  CLINIC_EXISTS_SQL,
} from '../../../../../../src/modules/Reservations/Shared/persistence/sequelize/ReservationSql.js';

const criteria: ReservationSourceCriteria = {
  startInclusive: new Date('2026-11-01T05:00:00Z'),
  endExclusive: new Date('2026-12-01T05:00:00Z'),
  status: 'SCHEDULED',
  clinicId: 3,
  clinicScope: { kind: 'CLINICS', clinicIds: [3] },
  direction: 'desc',
  onlyIds: ['900000000001001', '900000000001002'],
  excludeIds: ['900000000001003'],
  after: {
    appointmentAt: new Date('2026-11-02T15:00:00Z'),
    reservationId: '900000000001001',
  },
  limit: 25,
};

function maxPlaceholder(sql: string): number {
  return Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
}

describe('ReservationSql (fuente PostgreSQL de solo lectura, whitelist fija)', () => {
  it('todos los valores viajan como parámetros; el texto SQL no contiene datos del usuario', () => {
    const query = buildReservationListQuery(criteria);
    assert.equal(maxPlaceholder(query.sql), query.bind.length);
    for (const value of ['900000000001001', '900000000001003', '2026-11-02', '3]']) {
      assert.ok(!query.sql.includes(value), value);
    }
    assert.match(query.sql, /LIMIT \$\d+/);
    assert.ok(query.bind.includes(26), 'limit+1 para detectar página siguiente');
    assert.deepEqual(query.bind.at(-1), 26);
    assert.doesNotMatch(query.sql, /appointment_training_dataset_v1|client_history_current/);
  });

  it('nunca referencia el schema ml: los scores viven en el almacén local (ADR-006)', () => {
    for (const query of [
      buildReservationListQuery(criteria),
      buildReservationListQuery({ ...criteria, onlyIds: null, excludeIds: null, after: null }),
      buildReservationByIdQuery('9007199254740993'),
    ]) {
      assert.doesNotMatch(query.sql, /\bml\./);
    }
  });

  it('todo el SQL de la fuente es de solo lectura según el guard runtime', () => {
    for (const sql of [
      buildReservationListQuery(criteria).sql,
      buildReservationByIdQuery('1').sql,
      CLINIC_EXISTS_SQL,
    ]) {
      assert.equal(classifyReadOnlySql(sql), 'READ');
    }
  });

  it('onlyIds/excludeIds como arrays bigint parametrizados; sin exclusión vacía', () => {
    const query = buildReservationListQuery(criteria);
    assert.match(query.sql, /o\.appointment_id = ANY\(\$\d+::bigint\[\]\)/);
    assert.match(query.sql, /NOT \(o\.appointment_id = ANY\(\$\d+::bigint\[\]\)\)/);
    assert.ok(
      query.bind.some((value) => Array.isArray(value) && value.includes('900000000001002')),
    );
    const noExclusion = buildReservationListQuery({ ...criteria, excludeIds: [] });
    assert.doesNotMatch(noExclusion.sql, /NOT \(/);
    assert.equal(maxPlaceholder(noExclusion.sql), noExclusion.bind.length);
  });

  it('orden cronológico estable (appointment_at, appointment_id) y keyset en la misma dirección', () => {
    const desc = buildReservationListQuery(criteria);
    assert.match(desc.sql, /ORDER BY o\.appointment_at DESC, o\.appointment_id DESC/);
    assert.match(desc.sql, /\(o\.appointment_at, o\.appointment_id\) < /);
    const asc = buildReservationListQuery({ ...criteria, direction: 'asc' });
    assert.match(asc.sql, /ORDER BY o\.appointment_at ASC, o\.appointment_id ASC/);
    assert.match(asc.sql, /\(o\.appointment_at, o\.appointment_id\) > /);
  });

  it('canceladas futuras y alcance de sedes', () => {
    const cancelled = buildReservationListQuery({
      ...criteria,
      status: 'CANCELLED',
      clinicScope: { kind: 'ALL_CLINICS' },
    });
    assert.match(cancelled.sql, /o\.classification_detail = 'FUTURE_CANCELLED'/);
    assert.doesNotMatch(cancelled.sql, /integer\[\]/);
  });

  it('detalle por id parametrizado', () => {
    const query = buildReservationByIdQuery('9007199254740993');
    assert.deepEqual(query.bind, ['9007199254740993']);
    assert.equal(maxPlaceholder(query.sql), 1);
  });
});
