import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completedYears,
  limaDayRangeToInstants,
  limaLocalToInstant,
  parseLocalDate,
  toLimaParts,
} from '../../../../src/shared/time/LimaTime.js';

describe('LimaTime (America/Lima vía IANA, sin offsets fijos)', () => {
  it('convierte instantes UTC a componentes locales con día ISO', () => {
    assert.deepEqual(toLimaParts(new Date('2026-11-01T03:30:15Z')), {
      year: 2026,
      month: 10,
      day: 31,
      hour: 22,
      minute: 30,
      second: 15,
      isoWeekday: 6,
    });
    assert.throws(() => toLimaParts(new Date('invalid')), TypeError);
  });

  it('intervalo inclusivo por día ⇒ [inicio, siguiente medianoche) en UTC', () => {
    const range = limaDayRangeToInstants(
      { year: 2026, month: 12, day: 31 },
      { year: 2026, month: 12, day: 31 },
    );
    assert.equal(range.startInclusive.toISOString(), '2026-12-31T05:00:00.000Z');
    assert.equal(range.endExclusive.toISOString(), '2027-01-01T05:00:00.000Z');
    // Histórico: Lima aplicó horario de verano en 1994 (UTC-4); Intl lo resuelve.
    assert.equal(
      limaLocalToInstant({ year: 1994, month: 2, day: 1 }).toISOString(),
      '1994-02-01T04:00:00.000Z',
    );
  });

  it('parseLocalDate es estricto con el calendario', () => {
    assert.deepEqual(parseLocalDate('2028-02-29'), { year: 2028, month: 2, day: 29 });
    for (const bad of ['2027-02-29', '2026-13-01', '2026-1-01', '20261001', '2026-10-01T00:00']) {
      assert.equal(parseLocalDate(bad), null, bad);
    }
  });

  it('años cumplidos equivalen a AGE() de PostgreSQL (incluye 29-feb)', () => {
    assert.equal(
      completedYears({ year: 2000, month: 2, day: 29 }, { year: 2027, month: 2, day: 28 }),
      26,
    );
    assert.equal(
      completedYears({ year: 2000, month: 2, day: 29 }, { year: 2028, month: 2, day: 29 }),
      28,
    );
    assert.equal(
      completedYears({ year: 2000, month: 5, day: 10 }, { year: 2026, month: 5, day: 9 }),
      25,
    );
  });
});
