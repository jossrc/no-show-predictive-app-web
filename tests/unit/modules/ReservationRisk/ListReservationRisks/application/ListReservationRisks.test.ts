import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ListReservationRisks } from '../../../../../../src/modules/ReservationRisk/ListReservationRisks/application/ListReservationRisks.js';
import type { ListReservationRisksInput } from '../../../../../../src/modules/ReservationRisk/ListReservationRisks/application/input/ListReservationRisksInput.js';
import { RiskPolicyUnavailableException } from '../../../../../../src/modules/ReservationRisk/Shared/errors/RiskPolicyUnavailableException.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import type { RiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import { InvalidReservationQueryException } from '../../../../../../src/modules/Reservations/Shared/errors/InvalidReservationQueryException.js';
import { FakeRiskPolicy } from '../../../../../helpers/FakeRiskPolicy.js';
import { FixedClock } from '../../../../../helpers/FixedClock.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeReservation,
  makeStoredSnapshot,
  makeVerifiedSnapshot,
} from '../../../../../helpers/MakeSyntheticReservation.js';

const baseInput: ListReservationRisksInput = {
  from: '2026-11-01',
  to: '2026-11-30',
  status: 'SCHEDULED',
  clinicId: null,
  sort: 'appointmentAt',
  direction: 'asc',
  modelKey: 'random_forest_full_v1',
  riskLevel: null,
  experimentalRiskLevel: null,
  limit: 25,
  cursor: null,
  clinicScope: { kind: 'ALL_CLINICS' },
};

function setup(policy: RiskLevelPolicy = new PendingValidationRiskLevelPolicy()) {
  const store = new InMemoryPredictiveStore();
  const reservations = new InMemoryReservationRepository(store);
  const useCase = new ListReservationRisks({
    reservations,
    policy,
    evidenceSource: {
      servicesTemporalEvidence: 'NONE_CURRENT_REPLICA',
      snapshotEvidenceSource: 'VERIFIED_BOOKING_SNAPSHOT',
    },
    scores: store,
    mode: 'READ_ONLY_EXISTING_SCHEDULE',
    clock: new FixedClock(new Date('2026-10-25T15:00:00Z')),
  });
  return { store, reservations, useCase };
}

function scored(store: InMemoryPredictiveStore, id: string, p: number, at: string) {
  const verified = makeVerifiedSnapshot({
    reservationId: id,
    appointmentAt: new Date(at),
    appointmentEndAt: null,
  });
  const snapshot = makeStoredSnapshot({ snapshotId: `s${id}`, verified });
  store.addSnapshot(snapshot);
  store.results.push({
    resultId: id,
    predictionRunId: `run-${id}`,
    snapshotId: snapshot.snapshotId,
    modelKey: 'random_forest_full_v1',
    algorithm: 'random_forest',
    modelVersion: 'random_forest_full_v1:4e3c86a17005',
    modelHash: '4e3c86a17005',
    featureVersion: 'BOOKING_BASELINE_V1',
    predictionAt: snapshot.predictionAt,
    scoredAt: new Date('2026-10-22Z'),
    probabilityNoShow: p,
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
}

describe('ListReservationRisks (HU-01/HU-03)', () => {
  it('período vacío devuelve lista vacía (no error) con metadatos de política pendiente', async () => {
    const { useCase } = setup();
    const result = await useCase.execute(baseInput);
    assert.deepEqual(result.items, []);
    assert.equal(result.nextCursor, null);
    assert.equal(result.classificationUnavailable, true);
    assert.equal(result.riskPolicyStatus, 'pending_validation');
    assert.equal(result.period.startInclusive.toISOString(), '2026-11-01T05:00:00.000Z');
    assert.equal(result.period.endExclusive.toISOString(), '2026-12-01T05:00:00.000Z');
  });

  it('filtro u orden por nivel sin política aprobada ⇒ 409 RISK_POLICY_UNAVAILABLE (no lista vacía)', async () => {
    const { useCase, reservations } = setup();
    await assert.rejects(
      useCase.execute({ ...baseInput, riskLevel: 'HIGH' }),
      RiskPolicyUnavailableException,
    );
    await assert.rejects(
      useCase.execute({ ...baseInput, sort: 'riskLevel' }),
      RiskPolicyUnavailableException,
    );
    assert.equal(reservations.listCalls, 0);
  });

  it('rango inválido, período >92 días, sede inexistente y cursor ajeno ⇒ 422', async () => {
    const { useCase } = setup();
    await assert.rejects(
      useCase.execute({ ...baseInput, from: '2026-12-01', to: '2026-11-01' }),
      InvalidReservationQueryException,
    );
    await assert.rejects(
      useCase.execute({ ...baseInput, to: '2027-03-01' }),
      InvalidReservationQueryException,
    );
    await assert.rejects(
      useCase.execute({ ...baseInput, clinicId: 99 }),
      InvalidReservationQueryException,
    );
    await assert.rejects(
      useCase.execute({ ...baseInput, cursor: 'eyJ2IjoxfQ' }),
      InvalidReservationQueryException,
    );
  });

  it('orden exploratorio por probabilidad con nulos al final, desempate estable y paginación keyset', async () => {
    const { useCase, reservations, store } = setup();
    const ids = ['900000000001010', '900000000001011', '900000000001012', '900000000001013'];
    for (const [index, id] of ids.entries()) {
      reservations.add(
        makeReservation({
          reservationId: id,
          appointmentAt: new Date(`2026-11-0${index + 2}T15:00:00Z`),
        }),
      );
    }
    scored(store, ids[0]!, 0.3, '2026-11-02T15:00:00Z');
    scored(store, ids[1]!, 0.9, '2026-11-03T15:00:00Z');
    scored(store, ids[2]!, 0.3, '2026-11-04T15:00:00Z');

    const first = await useCase.execute({
      ...baseInput,
      sort: 'probabilityNoShow',
      direction: 'desc',
      limit: 2,
    });
    assert.deepEqual(
      first.items.map((i) => i.reservation.reservationId),
      [ids[1], ids[0]],
    );
    assert.equal(first.sort.semantics, 'EXPLORATORY_SCORE_ORDER');
    assert.ok(first.nextCursor);
    const second = await useCase.execute({
      ...baseInput,
      sort: 'probabilityNoShow',
      direction: 'desc',
      limit: 2,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      second.items.map((i) => i.reservation.reservationId),
      [ids[2], ids[3]],
    );
    assert.equal(second.items[1]!.predictionAvailability, 'NOT_SCORABLE');
    assert.equal(second.nextCursor, null);

    // Quitar el orden restaura el mismo universo cronológico del período.
    const plain = await useCase.execute(baseInput);
    assert.deepEqual(
      plain.items.map((i) => i.reservation.reservationId),
      ids,
    );
  });

  it('política SINTÉTICA de prueba habilita filtro LOW/MEDIUM/HIGH (nunca disponible en runtime real)', async () => {
    const { useCase, reservations, store } = setup(new FakeRiskPolicy());
    const ids = ['900000000001020', '900000000001021'];
    reservations.add(
      makeReservation({ reservationId: ids[0]!, appointmentAt: new Date('2026-11-05T15:00:00Z') }),
      makeReservation({ reservationId: ids[1]!, appointmentAt: new Date('2026-11-06T15:00:00Z') }),
    );
    scored(store, ids[0]!, 0.1, '2026-11-05T15:00:00Z');
    scored(store, ids[1]!, 0.8, '2026-11-06T15:00:00Z');
    const high = await useCase.execute({ ...baseInput, riskLevel: 'HIGH' });
    assert.deepEqual(
      high.items.map((i) => i.reservation.reservationId),
      [ids[1]],
    );
    assert.equal(high.items[0]!.scores[0]!.policyRiskLevel, 'HIGH');
    await assert.rejects(
      useCase.execute({ ...baseInput, riskLevel: 'HIGH', modelKey: 'xgboost_full_v1' }),
      RiskPolicyUnavailableException,
    );
  });

  it('canceladas no aparecen como programadas; alcance por sede filtra filas', async () => {
    const { useCase, reservations } = setup();
    reservations.add(
      makeReservation({
        reservationId: '900000000001030',
        appointmentAt: new Date('2026-11-05T15:00:00Z'),
      }),
      makeReservation({
        reservationId: '900000000001031',
        appointmentAt: new Date('2026-11-05T16:00:00Z'),
        status: 'CANCELLED',
      }),
      makeReservation({
        reservationId: '900000000001032',
        appointmentAt: new Date('2026-11-05T17:00:00Z'),
        clinicId: 2,
      }),
    );
    const scheduled = await useCase.execute(baseInput);
    assert.deepEqual(
      scheduled.items.map((i) => i.reservation.reservationId),
      ['900000000001030', '900000000001032'],
    );
    const cancelled = await useCase.execute({ ...baseInput, status: 'CANCELLED' });
    assert.deepEqual(
      cancelled.items.map((i) => i.reservation.reservationId),
      ['900000000001031'],
    );
    const scoped = await useCase.execute({
      ...baseInput,
      clinicScope: { kind: 'CLINICS', clinicIds: [2] },
    });
    assert.deepEqual(
      scoped.items.map((i) => i.reservation.reservationId),
      ['900000000001032'],
    );
  });
});
