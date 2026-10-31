import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GetReservationRisk } from '../../../../../../src/modules/ReservationRisk/GetReservationRisk/application/GetReservationRisk.js';
import { BookingSnapshotResolver } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/BookingSnapshotResolver.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { ReservationNotFoundException } from '../../../../../../src/modules/Reservations/Shared/errors/ReservationNotFoundException.js';
import { FakeBookingEvidenceSource } from '../../../../../helpers/FakeBookingEvidenceSource.js';
import { FixedClock } from '../../../../../helpers/FixedClock.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeBookingEvidence,
  makeReservation,
  makeStoredSnapshot,
  SYNTHETIC_RESERVATION_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

function setup(evidence = new FakeBookingEvidenceSource()) {
  const store = new InMemoryPredictiveStore();
  const reservations = new InMemoryReservationRepository(store);
  reservations.add(makeReservation());
  const clock = new FixedClock(new Date('2026-10-25T15:00:00Z'));
  const useCase = new GetReservationRisk({
    reservations,
    snapshots: new BookingSnapshotResolver(store, evidence, 'READ_ONLY_EXISTING_SCHEDULE'),
    results: store,
    policy: new PendingValidationRiskLevelPolicy(),
    mode: 'READ_ONLY_EXISTING_SCHEDULE',
    clock,
  });
  const run = (
    scope: { kind: 'ALL_CLINICS' } | { kind: 'CLINICS'; clinicIds: number[] } = {
      kind: 'ALL_CLINICS',
    },
  ) => useCase.execute({ reservationId: SYNTHETIC_RESERVATION_ID, clinicScope: scope });
  return { store, reservations, evidence, clock, run };
}

describe('GetReservationRisk (HU-02 lectura sin efectos)', () => {
  it('réplica sin evidencia ⇒ NOT_SCORABLE con motivos; nunca crea snapshots', async () => {
    const ctx = setup();
    ctx.evidence.add(makeBookingEvidence({ servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' }));
    const result = await ctx.run();
    assert.equal(result.assessment.status, 'NOT_SCORABLE');
    assert.deepEqual(
      result.assessment.reasons.map((r) => r.code),
      ['SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
    );
    assert.equal(ctx.store.snapshots.length, 0);
  });

  it('evidencia verificable sin snapshot ⇒ NOT_SCORED (la inferencia exige POST)', async () => {
    const ctx = setup(new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING'));
    ctx.evidence.add(makeBookingEvidence());
    const result = await ctx.run();
    assert.equal(result.assessment.status, 'NOT_SCORED');
    assert.equal(ctx.store.snapshots.length, 0);
  });

  it('snapshot con scores ⇒ AVAILABLE_EXPLORATORY; cita ya pasada marcada STALE_CLASSIFICATION', async () => {
    const ctx = setup();
    const snapshot = makeStoredSnapshot();
    ctx.store.addSnapshot(snapshot);
    ctx.store.results.push({
      resultId: '1',
      predictionRunId: 'run-1',
      snapshotId: snapshot.snapshotId,
      modelKey: 'random_forest_full_v1',
      algorithm: 'random_forest',
      modelVersion: 'random_forest_full_v1:4e3c86a17005',
      modelHash: '4e3c86a17005',
      featureVersion: 'BOOKING_BASELINE_V1',
      predictionAt: snapshot.predictionAt,
      scoredAt: new Date('2026-10-21Z'),
      probabilityNoShow: 0.42,
      predictionTarget: 'NO_SHOW_CANDIDATE',
      validationStatus: 'EXPLORATORY_NOT_VALIDATED',
      calibrationStatus: 'not_operationally_validated',
      operationalUseAllowed: false,
      riskLevel: null,
      riskPolicyVersion: null,
      riskPolicyStatus: 'pending_validation',
      scoringApiVersion: 'v1',
      modelHashSha256: null,
      experimentalRisk: null,
    });
    assert.equal((await ctx.run()).assessment.status, 'AVAILABLE_EXPLORATORY');
    ctx.clock.set(new Date('2026-11-13T00:00:00Z'));
    assert.equal((await ctx.run()).sourceFreshness, 'STALE_CLASSIFICATION');
  });

  it('reserva fuera del alcance de sedes ⇒ 404 idéntico a inexistente', async () => {
    const ctx = setup();
    await assert.rejects(
      ctx.run({ kind: 'CLINICS', clinicIds: [2] }),
      ReservationNotFoundException,
    );
  });
});
