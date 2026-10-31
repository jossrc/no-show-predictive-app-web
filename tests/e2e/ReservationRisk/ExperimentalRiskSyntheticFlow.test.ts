import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { AUTH_HEADERS, TEST_INTERNAL_API_KEY } from '../../helpers/BuildTestApp.js';
import {
  buildSyntheticLocalApp,
  type SyntheticLocalApp,
} from '../../helpers/BuildSyntheticLocalApp.js';
import { FakePredictionClient } from '../../helpers/FakePredictionClient.js';

/**
 * E2E HTTP de alta fidelidad del semáforo EXPERIMENTAL: composition root real en
 * SYNTHETIC_DEMO_ONLY (dataset versionado, SIN PostgreSQL), almacén SQLite real en archivo y
 * doble de Python ESTRICTO que solo responde (con respuestas reales de Python v2) si las 19
 * predictoras construidas por Node coinciden exactamente con un ejemplo publicado.
 */
const R = {
  case1: '900000000101001',
  case2: '900000000101002',
  case3: '900000000101003',
  case4: '900000000101004',
  example: '900000000101005',
  rescheduled: '900000000101006',
  cancelled: '900000000101007',
  noBookingTime: '900000000101008',
  clinic2: '900000000101009',
} as const;

const EXPECTED: Record<string, [string, string]> = {
  [R.case1]: ['LOW', 'LOW'],
  [R.case2]: ['HIGH', 'HIGH'],
  [R.case3]: ['MEDIUM', 'HIGH'],
  [R.case4]: ['LOW', 'MEDIUM'],
  [R.example]: ['HIGH', 'HIGH'],
};
const RF_POLICY = '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74';
const XGB_POLICY = '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032';
const NOVEMBER = 'from=2026-11-01&to=2026-11-30';

const directory = mkdtempSync(path.join(os.tmpdir(), 'nsp-e2e-'));
const sqlitePath = path.join(directory, 'synthetic.sqlite');
after(() => rmSync(directory, { recursive: true, force: true }));

function strictMl(): FakePredictionClient {
  const ml = new FakePredictionClient();
  ml.bandCasesByFeatures = true;
  return ml;
}

describe('E2E semáforo experimental v2 (SYNTHETIC_DEMO_ONLY + SQLite local, sin PostgreSQL)', () => {
  let ctx: SyntheticLocalApp;
  let ml: FakePredictionClient;
  const get = (url: string): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method: 'GET', url, headers: AUTH_HEADERS });
  const post = (
    id: string,
    payload: object = { mode: 'compare' },
  ): Promise<LightMyRequestResponse> =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/v1/reservations/${id}/predictions`,
      headers: AUTH_HEADERS,
      payload,
    });
  const ids = (body: { data: Array<{ reservationId: string }> }) =>
    body.data.map((d) => d.reservationId);

  before(() => {
    ml = strictMl();
    ctx = buildSyntheticLocalApp({ ml, sqlitePath });
  });

  it('health del almacén local y política experimental publicada (disponible ≠ aprobada)', async () => {
    const health = (
      await ctx.app.inject({ method: 'GET', url: '/api/v1/health/predictive-store' })
    ).json();
    assert.deepEqual(
      [
        health.status,
        health.driver,
        health.dataSourceMode,
        health.durable,
        health.sourceDatabaseWritable,
      ],
      ['ok', 'sqlite', 'SYNTHETIC_DEMO_ONLY', true, false],
    );
    const policy = (await get('/api/v1/ml/research-risk-policy')).json().data;
    assert.deepEqual(
      [policy.available, policy.status, policy.reason],
      [true, 'RESEARCH_PROVISIONAL', null],
    );
    assert.equal(policy.approvedRiskPolicyStatus, 'pending_validation');
    assert.equal(policy.operationalUseAllowed, false);
    assert.deepEqual(
      policy.policies.map((p: { policyHash: string }) => p.policyHash),
      [RF_POLICY, XGB_POLICY],
    );
    assert.ok(policy.policies.every((p: { approvedBy: null }) => p.approvedBy === null));
    const models = (await get('/api/v1/ml/models')).json().data;
    assert.equal(models.riskPolicyStatus, 'pending_validation');
    assert.equal(models.experimentalRiskPolicy.available, true);
    assert.equal(models.models.length, 2);
  });

  it('listado inicial: NOT_SCORED para evaluables y NOT_SCORABLE con motivos verdaderos', async () => {
    const body = (await get(`/api/v1/reservations?${NOVEMBER}`)).json();
    assert.deepEqual(ids(body), [
      R.example,
      R.case1,
      R.rescheduled,
      R.noBookingTime,
      R.case2,
      R.clinic2,
      R.case4,
      R.case3,
    ]);
    const availability = Object.fromEntries(
      body.data.map(
        (d: {
          reservationId: string;
          risk: { predictionAvailability: string; notScorableReasons: Array<{ code: string }> };
        }) => [
          d.reservationId,
          [d.risk.predictionAvailability, d.risk.notScorableReasons.map((r) => r.code).join(',')],
        ],
      ),
    );
    assert.deepEqual(availability[R.case1], ['NOT_SCORED', '']);
    assert.deepEqual(availability[R.rescheduled], [
      'NOT_SCORABLE',
      'RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT',
    ]);
    assert.deepEqual(availability[R.noBookingTime], ['NOT_SCORABLE', 'MISSING_BOOKING_TIME']);
    assert.equal(body.experimentalRiskPolicy, null);
    assert.equal(body.experimentalClassificationUnavailable, true);
    assert.equal(body.sourceStatus, 'SYNTHETIC_DEMO_ONLY');
  });

  it('POST compare ⇒ 201 con score exacto, porcentaje y banda v2 por modelo; replay 200 sin Python', async () => {
    for (const id of Object.keys(EXPECTED)) {
      const created = await post(id);
      assert.equal(created.statusCode, 201, `${id}: ${created.body}`);
      const data = created.json().data;
      assert.deepEqual(
        data.models.map((m: { experimentalRisk: { level: string } }) => m.experimentalRisk.level),
        EXPECTED[id],
      );
      assert.equal(data.riskLevel, null);
      assert.equal(data.classificationBasis, 'RESEARCH_PROVISIONAL');
      assert.equal(data.operationalClassificationUnavailable, true);
      assert.equal(data.experimentalClassificationUnavailable, false);
      assert.equal(data.classificationUnavailable, false);
      assert.match(data.experimentalRiskNotice, /EXPERIMENTAL/);
      for (const model of data.models) {
        assert.equal(model.riskLevel, null);
        assert.equal(model.operationalUseAllowed, false);
        assert.equal(model.scoringApiVersion, 'v2');
        assert.equal(model.percentageNoShow, model.probabilityNoShow * 100);
        assert.equal(model.experimentalRisk.approvedBy, null);
        assert.equal(model.experimentalRisk.operationalUseAllowed, false);
        assert.equal(
          model.experimentalRisk.policyHash,
          model.modelKey === 'random_forest_full_v1' ? RF_POLICY : XGB_POLICY,
        );
      }
      assert.equal(data.comparison.selectedWinner, null);
      assert.equal(data.comparison.ensembleProbability, null);
    }
    const example = (await get(`/api/v1/reservations/${R.example}/risk`)).json().data;
    assert.ok(Math.abs(example.models[0].probabilityNoShow - 0.6976400433344135) <= 1e-12);
    assert.equal(example.models[1].probabilityNoShow, 0.9159286618232727);
    assert.ok(
      Math.abs(example.comparison.absoluteProbabilityDifference - 0.21828861848885917) <= 1e-12,
    );

    const calls = ml.callsOf('research_compare').length;
    const replay = await post(R.case3);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.run.replayed, true);
    assert.equal(ml.callsOf('research_compare').length, calls);
    assert.equal(
      ml.callsOf('compare').length,
      0,
      'v1 compare no se usa con la política disponible',
    );
  });

  it('GET risk/detalle leen lo persistido (sin Python) y conservan evidencia sintética e identidad', async () => {
    const before = ml.calls.length;
    const risk = (await get(`/api/v1/reservations/${R.case3}/risk`)).json().data;
    assert.equal(risk.status, 'AVAILABLE_EXPLORATORY');
    assert.equal(risk.snapshot.evidenceSource, 'SYNTHETIC_DEMO_ONLY');
    assert.deepEqual(
      risk.models.map((m: { experimentalRisk: { level: string } }) => m.experimentalRisk.level),
      ['MEDIUM', 'HIGH'],
    );
    assert.equal(risk.models[0].modelHashSha256.slice(0, 12), risk.models[0].modelHash);
    const detail = (await get(`/api/v1/reservations/${R.case3}`)).json().data;
    assert.deepEqual(
      detail.scores.map((s: { experimentalRisk: { level: string; policyVersion: string } }) => [
        s.experimentalRisk.level,
        s.experimentalRisk.policyVersion,
      ]),
      [
        ['MEDIUM', 'research_risk_v1_1'],
        ['HIGH', 'research_risk_v1_1'],
      ],
    );
    assert.equal(ml.calls.length, before, 'GET nunca infiere');
  });

  it('filtros experimentalRiskLevel por modelo elegido: exactos para RF y XGB, sin combinar modelos', async () => {
    const level = async (modelKey: string, experimentalRiskLevel: string) =>
      ids(
        (
          await get(
            `/api/v1/reservations?${NOVEMBER}&modelKey=${modelKey}&experimentalRiskLevel=${experimentalRiskLevel}`,
          )
        ).json(),
      );
    assert.deepEqual(await level('random_forest_full_v1', 'HIGH'), [R.example, R.case2]);
    assert.deepEqual(await level('random_forest_full_v1', 'MEDIUM'), [R.case3]);
    assert.deepEqual(await level('random_forest_full_v1', 'LOW'), [R.case1, R.case4]);
    assert.deepEqual(await level('xgboost_full_v1', 'HIGH'), [R.example, R.case2, R.case3]);
    assert.deepEqual(await level('xgboost_full_v1', 'MEDIUM'), [R.case4]);
    assert.deepEqual(await level('xgboost_full_v1', 'LOW'), [R.case1]);

    const body = (
      await get(
        `/api/v1/reservations?${NOVEMBER}&modelKey=xgboost_full_v1&experimentalRiskLevel=HIGH`,
      )
    ).json();
    assert.equal(body.experimentalRiskPolicy.policyHash, XGB_POLICY);
    assert.equal(body.experimentalRiskPolicy.operationalUseAllowed, false);
    assert.ok(
      body.data.every(
        (d: {
          risk: {
            experimentalRisk: { level: string };
            experimentalPolicyCurrent: boolean;
            riskLevel: null;
          };
        }) =>
          d.risk.experimentalRisk.level === 'HIGH' &&
          d.risk.experimentalPolicyCurrent &&
          d.risk.riskLevel === null,
      ),
    );
  });

  it('orden por banda experimental y por score, paginado con cursor firmado, NULLS LAST', async () => {
    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/v1/reservations?${NOVEMBER}&modelKey=random_forest_full_v1&sort=experimentalRisk&direction=desc&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const body: {
        data: Array<{ reservationId: string }>;
        pagination: { nextCursor: string | null };
        sort: { semantics: string };
      } = (await get(url)).json();
      assert.equal(body.sort.semantics, 'EXPERIMENTAL_RESEARCH_BAND_ORDER');
      pages.push(...ids(body));
      cursor = body.pagination.nextCursor;
    } while (cursor);
    assert.deepEqual(pages, [
      R.case2,
      R.example,
      R.case3,
      R.case1,
      R.case4,
      R.rescheduled,
      R.noBookingTime,
      R.clinic2,
    ]);

    const byScore = (
      await get(
        `/api/v1/reservations?${NOVEMBER}&modelKey=xgboost_full_v1&sort=probabilityNoShow&direction=asc&limit=2`,
      )
    ).json();
    assert.deepEqual(ids(byScore), [R.case1, R.case4]);
    const tampered = await get(
      `/api/v1/reservations?${NOVEMBER}&modelKey=random_forest_full_v1&sort=probabilityNoShow&direction=asc&limit=2&cursor=${byScore.pagination.nextCursor}`,
    );
    assert.deepEqual(
      [tampered.statusCode, tampered.json().error.code],
      [422, 'INVALID_CURSOR'],
      'cursor ligado a modelo/filtros/política',
    );
  });

  it('riesgo OPERATIVO sigue bloqueado: riskLevel=HIGH o sort=riskLevel ⇒ 409 RISK_POLICY_UNAVAILABLE', async () => {
    for (const query of ['riskLevel=HIGH', 'sort=riskLevel']) {
      const response = await get(`/api/v1/reservations?${NOVEMBER}&${query}`);
      assert.deepEqual(
        [response.statusCode, response.json().error.code],
        [409, 'RISK_POLICY_UNAVAILABLE'],
      );
    }
    const invalid = await get(`/api/v1/reservations?${NOVEMBER}&experimentalRiskLevel=CRITICAL`);
    assert.equal(invalid.statusCode, 400);
  });

  it('SHAP v1 sobre EXACTAMENTE el snapshot guardado; RF probabilidad, XGB log-odds; score intacto', async () => {
    const local = new DatabaseSync(sqlitePath, { readOnly: true });
    const stored = JSON.parse(
      String(
        local
          .prepare('SELECT features_json FROM booking_feature_snapshots WHERE reservation_id = ?')
          .get(R.case2)?.features_json,
      ),
    );
    const resultsBefore = local
      .prepare('SELECT count(*) AS n FROM prediction_model_results')
      .get()?.n;
    for (const [modelKey, space] of [
      ['random_forest_full_v1', 'probability'],
      ['xgboost_full_v1', 'log_odds'],
    ] as const) {
      const factors = (
        await get(`/api/v1/reservations/${R.case2}/risk/factors?modelKey=${modelKey}&topK=3`)
      ).json().data;
      assert.equal(factors.explanation.outputSpace, space);
      assert.equal(factors.explanation.factors.length, 3);
      assert.equal(factors.riskLevel, null);
      assert.equal(factors.persistedScore.experimentalRisk.level, 'HIGH');
      const sent = ml.callsOf('explain').at(-1)!.request as {
        features: unknown;
        model_key: string;
      };
      assert.deepEqual(sent.features, stored);
      assert.equal(sent.model_key, modelKey);
    }
    assert.equal(
      local.prepare('SELECT count(*) AS n FROM prediction_model_results').get()?.n,
      resultsBefore,
      'SHAP no escribe',
    );
    ml.failWith('explain', new Error('SHAP caído'));
    assert.equal((await get(`/api/v1/reservations/${R.case2}/risk/factors`)).statusCode, 500);
    ml.clearFailures();
    assert.equal(
      (await get(`/api/v1/reservations/${R.case2}/risk`)).json().data.models.length,
      2,
      'un fallo de SHAP no borra el score',
    );
    local.close();
  });

  it('reinicio: un proceso nuevo sobre el mismo archivo recupera scores y bandas sin llamar a Python', async () => {
    await ctx.close();
    const fresh = strictMl();
    const restarted = buildSyntheticLocalApp({ ml: fresh, sqlitePath });
    const risk = (
      await restarted.app.inject({
        method: 'GET',
        url: `/api/v1/reservations/${R.case4}/risk`,
        headers: AUTH_HEADERS,
      })
    ).json().data;
    assert.deepEqual(
      risk.models.map((m: { experimentalRisk: { level: string } }) => m.experimentalRisk.level),
      ['LOW', 'MEDIUM'],
    );
    const replay = await restarted.app.inject({
      method: 'POST',
      url: `/api/v1/reservations/${R.case4}/predictions`,
      headers: AUTH_HEADERS,
      payload: { mode: 'compare' },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(fresh.callsOf('research_compare').length, 0);
    ctx = restarted;
    ml = fresh;
  });

  it('6 POST concurrentes ⇒ 1 run y 2 scores; ninguna respuesta expone la clave ni datos personales', async () => {
    const concurrentFile = path.join(directory, 'concurrent.sqlite');
    const concurrentMl = strictMl();
    const app = buildSyntheticLocalApp({ ml: concurrentMl, sqlitePath: concurrentFile });
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.app.inject({
          method: 'POST',
          url: `/api/v1/reservations/${R.case2}/predictions`,
          headers: AUTH_HEADERS,
          payload: { mode: 'compare' },
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 200, 200, 200, 200, 201]);
    assert.equal(concurrentMl.callsOf('research_compare').length, 1);
    const local = new DatabaseSync(concurrentFile, { readOnly: true });
    assert.equal(local.prepare('SELECT count(*) AS n FROM prediction_runs').get()?.n, 1);
    assert.equal(local.prepare('SELECT count(*) AS n FROM prediction_model_results').get()?.n, 2);
    assert.equal(local.prepare('SELECT count(*) AS n FROM booking_feature_snapshots').get()?.n, 1);
    local.close();
    for (const response of responses) {
      assert.ok(!response.body.includes(TEST_INTERNAL_API_KEY));
      assert.ok(!response.body.includes('1998-03-15'), 'sin fecha de nacimiento');
      assert.ok(!response.body.includes('"age_at_booking"'), 'sin payload de features');
    }
    const logs = app.logLines.join('\n');
    assert.ok(!logs.includes(TEST_INTERNAL_API_KEY) && !logs.includes('1998-03-15'));
    await app.close();
  });

  it('seguridad: sin credencial 401; IDs/filtros maliciosos 400 antes de tocar datos', async () => {
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/reservations?${NOVEMBER}` })).statusCode,
      401,
    );
    for (const url of [
      `/api/v1/reservations/1%27%20OR%201=1/risk`,
      `/api/v1/reservations/${R.case1};DROP/risk`,
      `/api/v1/reservations?${NOVEMBER}&clinicId=1%20OR%201=1`,
      `/api/v1/reservations?${NOVEMBER}&modelKey=random_forest_full_v1%27--`,
      `/api/v1/reservations?${NOVEMBER}&cursor=%27%3BDROP`,
    ]) {
      assert.equal((await get(url)).statusCode, 400, url);
    }
  });

  after(async () => ctx.close());
});

describe('E2E sin política research en Python (o deshabilitada en Node)', () => {
  it('Python UNAVAILABLE ⇒ POST 503 RESEARCH_RISK_POLICY_NOT_READY; listado y v1 siguen operando', async () => {
    const ml = strictMl();
    ml.researchPolicy = 'unavailable';
    const ctx = buildSyntheticLocalApp({ ml, sqlitePath: ':memory:' });
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/reservations/${R.case1}/predictions`,
      headers: AUTH_HEADERS,
      payload: { mode: 'compare' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'RESEARCH_RISK_POLICY_NOT_READY');
    assert.deepEqual(response.json().error.details, {
      field: 'experimental_risk',
      reason: 'disabled',
    });
    assert.equal(ml.callsOf('compare').length + ml.callsOf('research_compare').length, 0);
    const policy = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/ml/research-risk-policy',
        headers: AUTH_HEADERS,
      })
    ).json().data;
    assert.deepEqual(
      [policy.available, policy.status, policy.reason],
      [false, 'UNAVAILABLE', 'disabled'],
    );
    const models = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/ml/models',
      headers: AUTH_HEADERS,
    });
    assert.equal(models.statusCode, 200, 'el catálogo v1 sigue disponible');
    assert.equal(models.json().data.experimentalRiskPolicy.available, false);
    assert.equal(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/reservations?${NOVEMBER}`,
          headers: AUTH_HEADERS,
        })
      ).statusCode,
      200,
    );
    await ctx.close();
  });

  it('ML_RESEARCH_RISK_ENABLED=false ⇒ scores v1 explícitos sin banda (experimentalRisk=null) y razón tipada', async () => {
    const ml = new FakePredictionClient();
    const ctx = buildSyntheticLocalApp({ ml, sqlitePath: ':memory:', researchEnabled: false });
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/reservations/${R.case1}/predictions`,
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      })
    ).json().data;
    assert.ok(
      created.models.every(
        (m: {
          experimentalRisk: null;
          experimentalRiskUnavailableReason: string;
          scoringApiVersion: string;
        }) =>
          m.experimentalRisk === null &&
          m.experimentalRiskUnavailableReason === 'SCORED_WITHOUT_RESEARCH_POLICY' &&
          m.scoringApiVersion === 'v1',
      ),
    );
    assert.equal(created.classificationUnavailable, true);
    assert.equal(created.classificationBasis, null);
    const policy = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/ml/research-risk-policy',
        headers: AUTH_HEADERS,
      })
    ).json().data;
    assert.deepEqual(
      [policy.nodeResearchRiskEnabled, policy.reason],
      [false, 'disabled_by_node_configuration'],
    );
    assert.equal(ml.callsOf('research_policy').length, 0);
    await ctx.close();
  });
});
