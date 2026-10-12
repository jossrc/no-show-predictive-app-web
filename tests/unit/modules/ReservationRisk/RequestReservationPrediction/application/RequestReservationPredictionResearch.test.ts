import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachedMlModelCatalog } from '../../../../../../src/infrastructure/http/ml/CachedMlModelCatalog.js';
import { CachedResearchPolicyCatalog } from '../../../../../../src/infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import type { MlResearchCompareResponse } from '../../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { MlContractViolationException } from '../../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { MlResearchPolicyUnavailableException } from '../../../../../../src/infrastructure/http/ml/errors/MlResearchPolicyUnavailableException.js';
import { RequestReservationPrediction } from '../../../../../../src/modules/ReservationRisk/RequestReservationPrediction/application/RequestReservationPrediction.js';
import { BookingSnapshotResolver } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/BookingSnapshotResolver.js';
import { RiskFeaturesBuilder } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { PendingValidationRiskLevelPolicy } from '../../../../../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import { FakeBookingEvidenceSource } from '../../../../../helpers/FakeBookingEvidenceSource.js';
import { FakePredictionClient } from '../../../../../helpers/FakePredictionClient.js';
import { FixedClock } from '../../../../../helpers/FixedClock.js';
import { InMemoryClientHistoryRepository } from '../../../../../helpers/InMemoryClientHistoryRepository.js';
import { InMemoryPredictiveStore } from '../../../../../helpers/InMemoryPredictiveStore.js';
import { InMemoryReservationRepository } from '../../../../../helpers/InMemoryReservationRepository.js';
import {
  makeBookingEvidence,
  makeReservation,
  SYNTHETIC_RESERVATION_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

const RF_POLICY = '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74';
const XGB_POLICY = '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032';

function setup(options: { enabled?: boolean } = {}) {
  const store = new InMemoryPredictiveStore();
  const reservations = new InMemoryReservationRepository(store);
  const evidence = new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING');
  evidence.add(makeBookingEvidence());
  const ml = new FakePredictionClient();
  reservations.add(makeReservation());
  const catalog = new CachedResearchPolicyCatalog(ml, { ttlMs: 60_000, expectedPolicyHashes: [] });
  const useCase = new RequestReservationPrediction({
    reservations,
    resolver: new BookingSnapshotResolver(store, evidence, 'READ_ONLY_EXISTING_SCHEDULE'),
    history: new InMemoryClientHistoryRepository(),
    builder: new RiskFeaturesBuilder(),
    snapshots: store,
    results: store,
    ml,
    modelCatalog: new CachedMlModelCatalog(ml, 60_000),
    research: { enabled: options.enabled ?? true, catalog },
    policy: new PendingValidationRiskLevelPolicy(),
    mode: 'READ_ONLY_EXISTING_SCHEDULE',
    clock: new FixedClock(new Date('2026-10-25T15:00:00Z')),
  });
  const execute = (
    prediction:
      | { mode: 'compare' }
      | { mode: 'single'; modelKey: 'random_forest_full_v1' | 'xgboost_full_v1' } = {
      mode: 'compare',
    },
  ) =>
    useCase.execute({
      reservationId: SYNTHETIC_RESERVATION_ID,
      prediction,
      requestId: 'req-v2',
      clinicScope: { kind: 'ALL_CLINICS' },
    });
  return { store, ml, catalog, execute };
}

describe('RequestReservationPrediction con política research v2 (banda experimental)', () => {
  it('compare ⇒ /v2 compare, persiste score crudo + banda de cada modelo con su política; riskLevel null', async () => {
    const { store, ml, execute } = setup();
    ml.bandCase = 'synthetic-case-3';
    const result = await execute();

    assert.equal(ml.callsOf('research_compare').length, 1);
    assert.equal(ml.callsOf('compare').length, 0, 'sin inferencia v1 cuando v2 está habilitado');
    assert.deepEqual(
      result.assessment.models.map((m) => [
        m.modelKey,
        m.experimentalRisk?.level,
        m.experimentalRisk?.policyHash,
        m.policyRiskLevel,
      ]),
      [
        ['random_forest_full_v1', 'MEDIUM', RF_POLICY, null],
        ['xgboost_full_v1', 'HIGH', XGB_POLICY, null],
      ],
    );
    assert.equal(result.assessment.experimentalClassificationAvailable, true);
    assert.equal(result.assessment.operationalClassificationAvailable, false);
    assert.ok(
      store.results.every((r) => r.scoringApiVersion === 'v2' && r.operationalUseAllowed === false),
    );
    assert.equal(store.runs[0]?.scoringApiVersion, 'v2');
    assert.equal(store.results[0]?.modelHashSha256?.length, 64);
  });

  it('single XGB ⇒ /v2 predictions del modelo pedido; repetir no llama a Python (idempotencia por política)', async () => {
    const { store, ml, execute } = setup();
    await execute({ mode: 'single', modelKey: 'xgboost_full_v1' });
    const replay = await execute({ mode: 'single', modelKey: 'xgboost_full_v1' });
    assert.equal(ml.callsOf('research_predict').length, 1);
    assert.equal(replay.run.replayed, true);
    assert.equal(store.results.length, 1);
    assert.equal(store.results[0]?.experimentalRisk?.policyHash, XGB_POLICY);
  });

  it('política UNAVAILABLE ⇒ 503 RESEARCH_RISK_POLICY_NOT_READY, sin fallback a v1, sin persistir ni LOW', async () => {
    const { store, ml, execute } = setup();
    ml.researchPolicy = 'unavailable';
    await assert.rejects(
      () => execute(),
      (error: unknown) =>
        error instanceof MlResearchPolicyUnavailableException && error.reason === 'disabled',
    );
    assert.equal(ml.callsOf('research_compare').length + ml.callsOf('compare').length, 0);
    assert.equal(store.results.length, 0);
  });

  it('respuesta v2 con política distinta a la publicada ⇒ 502 sin guardar y catálogo refrescado', async () => {
    const { store, ml, execute } = setup();
    const original = ml.compareResearch.bind(ml);
    ml.compareResearch = async (request, context) => {
      const response: MlResearchCompareResponse = await original(request, context);
      response.results[0].experimental_risk.policy_hash = 'a'.repeat(64);
      return response;
    };
    await assert.rejects(() => execute(), MlContractViolationException);
    assert.equal(store.results.length, 0);
    assert.equal(store.runs.length, 0);
    ml.compareResearch = original;
    await execute();
    assert.equal(
      ml.callsOf('research_policy').length,
      2,
      'el catálogo se recargó tras la discrepancia',
    );
  });

  it('un score v1 previo NO se reinterpreta: con v2 habilitado se solicita y guarda un score nuevo', async () => {
    const legacy = setup({ enabled: false });
    await legacy.execute();
    assert.equal(
      legacy.store.results.every((r) => r.experimentalRisk === null),
      true,
    );

    const { store, ml, execute } = setup();
    store.snapshots.push(...legacy.store.snapshots);
    store.results.push(...legacy.store.results);
    const result = await execute();
    assert.equal(ml.callsOf('research_compare').length, 1);
    assert.equal(result.run.replayed, false);
    assert.equal(store.results.length, 4, 'v1 conservado + v2 nuevo por modelo');
    assert.ok(result.assessment.models.every((m) => m.experimentalRisk !== null));
  });

  it('6 peticiones concurrentes idénticas ⇒ UNA inferencia, 1 run y 2 scores (single-flight + UNIQUE)', async () => {
    const { store, ml, execute } = setup();
    const results = await Promise.all(Array.from({ length: 6 }, () => execute()));
    assert.equal(ml.callsOf('research_compare').length, 1);
    assert.equal(store.runs.length, 1);
    assert.equal(store.results.length, 2);
    assert.equal(results.filter((r) => r.run.predictionRunId !== null).length, 1);
    assert.ok(results.every((r) => r.assessment.models.length === 2));
  });

  it('ML_RESEARCH_RISK_ENABLED=false ⇒ camino v1 explícito: sin banda y sin consultar la política', async () => {
    const { ml, execute } = setup({ enabled: false });
    const result = await execute();
    assert.equal(ml.callsOf('compare').length, 1);
    assert.equal(ml.callsOf('research_policy').length, 0);
    assert.ok(
      result.assessment.models.every(
        (m) => m.experimentalRisk === null && m.scoringApiVersion === 'v1',
      ),
    );
  });
});
