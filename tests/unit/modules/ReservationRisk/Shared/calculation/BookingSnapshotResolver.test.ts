import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PersistenceUnavailableException } from '../../../../../../src/infrastructure/database/errors/PersistenceUnavailableException.js';
import { BookingSnapshotResolver } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/BookingSnapshotResolver.js';
import type { BookingSnapshotRepository } from '../../../../../../src/modules/ReservationRisk/Shared/persistence/BookingSnapshotRepository.js';
import { FakeBookingEvidenceSource } from '../../../../../helpers/FakeBookingEvidenceSource.js';
import {
  makeBookingEvidence,
  makeReservation,
} from '../../../../../helpers/MakeSyntheticReservation.js';

function failingRepository(
  reason: 'PREDICTIVE_SCHEMA_NOT_MIGRATED' | 'QUERY_FAILED',
): BookingSnapshotRepository {
  return {
    findLatestUsable: async () => {
      throw new PersistenceUnavailableException({ operation: 'FindBookingSnapshot', reason });
    },
    saveIfAbsent: async () => {
      throw new PersistenceUnavailableException({ operation: 'SaveBookingSnapshot', reason });
    },
  };
}

describe('BookingSnapshotResolver', () => {
  it('sin snapshot persistido, ausencia verificada de copias FLOWww ⇒ VERIFIED_SOURCE', async () => {
    const evidence = new FakeBookingEvidenceSource();
    evidence.add(makeBookingEvidence({ servicesTemporalEvidence: 'FLOWWW_UNCHANGED_BOOKING' }));
    const resolver = new BookingSnapshotResolver(
      failingRepository('PREDICTIVE_SCHEMA_NOT_MIGRATED'),
      evidence,
      'READ_ONLY_EXISTING_SCHEDULE',
    );
    const resolution = await resolver.resolve(makeReservation());
    assert.equal(resolution.kind, 'VERIFIED_SOURCE');
    if (resolution.kind === 'VERIFIED_SOURCE') {
      assert.equal(resolution.verified.servicesTemporalEvidence, 'FLOWWW_UNCHANGED_BOOKING');
    }
  });
  it('almacén predictivo sin migrar en lectura ⇒ continúa con la evidencia (NOT_SCORABLE informativo)', async () => {
    const evidence = new FakeBookingEvidenceSource();
    evidence.add(makeBookingEvidence({ servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' }));
    const resolver = new BookingSnapshotResolver(
      failingRepository('PREDICTIVE_SCHEMA_NOT_MIGRATED'),
      evidence,
      'READ_ONLY_EXISTING_SCHEDULE',
    );
    const resolution = await resolver.resolve(makeReservation());
    assert.equal(resolution.kind, 'NOT_SCORABLE');
  });

  it('otros fallos de persistencia se propagan (no se ocultan como «sin snapshot»)', async () => {
    const resolver = new BookingSnapshotResolver(
      failingRepository('QUERY_FAILED'),
      new FakeBookingEvidenceSource(),
      'READ_ONLY_EXISTING_SCHEDULE',
    );
    await assert.rejects(resolver.resolve(makeReservation()), PersistenceUnavailableException);
  });
});
