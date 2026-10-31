import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { createMlPredictionClient } from '../../../src/app/CreatePredictiveDependencies.js';
import { EnvironmentSchema } from '../../../src/config/environment/EnvironmentSchema.js';
import { createPredictiveConfig } from '../../../src/config/PredictiveConfig.js';
import { AUTH_HEADERS } from '../../helpers/BuildTestApp.js';
import { buildSyntheticLocalApp } from '../../helpers/BuildSyntheticLocalApp.js';
import { reportSkipped } from '../../helpers/ReportSkipped.js';

/**
 * E2E REAL Node ↔ Python v2 sin PostgreSQL (opt-in): ML_RUN_REAL_INTEGRATION=1,
 * ML_REAL_SERVICE_URL, ML_REAL_SERVICE_KEY. Instancia SYNTHETIC_DEMO_ONLY con dataset local
 * versionado y SQLite en un directorio temporal; Python real calcula score, banda y SHAP.
 */
const enabled =
  process.env.ML_RUN_REAL_INTEGRATION === '1' &&
  process.env.ML_REAL_SERVICE_URL &&
  process.env.ML_REAL_SERVICE_KEY;
const skip = enabled
  ? false
  : 'SKIP: ML_RUN_REAL_INTEGRATION=1 + ML_REAL_SERVICE_URL/KEY no definidos';
reportSkipped('SyntheticLocalRealMlFlow', skip);

const EXPECTED: Record<string, [string, string]> = {
  '900000000101001': ['LOW', 'LOW'],
  '900000000101002': ['HIGH', 'HIGH'],
  '900000000101003': ['MEDIUM', 'HIGH'],
  '900000000101004': ['LOW', 'MEDIUM'],
  '900000000101005': ['HIGH', 'HIGH'],
};
const NOVEMBER = 'from=2026-11-01&to=2026-11-30';

function realMl() {
  const config = createPredictiveConfig(
    EnvironmentSchema.parse({
      ...process.env,
      ML_SERVICE_URL: process.env.ML_REAL_SERVICE_URL,
      ML_SERVICE_KEY: process.env.ML_REAL_SERVICE_KEY,
      ML_EXPLAIN_TIMEOUT_MS: '30000',
      ML_HTTP_TIMEOUT_MS: '15000',
    }),
  );
  return createMlPredictionClient(config.ml, { info: () => undefined, warn: () => undefined });
}

describe(
  'E2E real Node ↔ Python v2 (SYNTHETIC_DEMO_ONLY + SQLite, sin PostgreSQL)',
  { skip },
  () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'nsp-real-'));
    const sqlitePath = path.join(directory, 'synthetic.sqlite');
    after(() => rmSync(directory, { recursive: true, force: true }));

    it('POST compare real ⇒ bandas publicadas por Python para cada caso; GET/listado/filtros/SHAP coherentes', async () => {
      const ctx = buildSyntheticLocalApp({ ml: realMl(), sqlitePath });
      const get = (url: string) => ctx.app.inject({ method: 'GET', url, headers: AUTH_HEADERS });
      try {
        assert.equal(
          (await ctx.app.inject({ method: 'GET', url: '/api/v1/health/ml' })).json().status,
          'ok',
        );
        const policy = (await get('/api/v1/ml/research-risk-policy')).json().data;
        assert.equal(policy.available, true);

        for (const [id, levels] of Object.entries(EXPECTED)) {
          const created = await ctx.app.inject({
            method: 'POST',
            url: `/api/v1/reservations/${id}/predictions`,
            headers: AUTH_HEADERS,
            payload: { mode: 'compare' },
          });
          assert.equal(created.statusCode, 201, created.body);
          const data = created.json().data;
          assert.deepEqual(
            data.models.map(
              (m: { experimentalRisk: { level: string } }) => m.experimentalRisk.level,
            ),
            levels,
            id,
          );
          assert.equal(data.riskLevel, null);
          assert.ok(
            data.models.every(
              (m: { operationalUseAllowed: boolean; riskLevel: null }) =>
                m.operationalUseAllowed === false && m.riskLevel === null,
            ),
          );
        }
        const example = (await get('/api/v1/reservations/900000000101005/risk')).json().data;
        assert.ok(Math.abs(example.models[0].probabilityNoShow - 0.6976400433344135) <= 1e-12);
        assert.equal(example.models[1].probabilityNoShow, 0.9159286618232727);

        const xgbHigh = (
          await get(
            `/api/v1/reservations?${NOVEMBER}&modelKey=xgboost_full_v1&experimentalRiskLevel=HIGH`,
          )
        ).json();
        assert.deepEqual(
          xgbHigh.data.map((d: { reservationId: string }) => d.reservationId),
          ['900000000101005', '900000000101002', '900000000101003'],
        );
        const rfMedium = (
          await get(
            `/api/v1/reservations?${NOVEMBER}&modelKey=random_forest_full_v1&experimentalRiskLevel=MEDIUM`,
          )
        ).json();
        assert.deepEqual(
          rfMedium.data.map((d: { reservationId: string }) => d.reservationId),
          ['900000000101003'],
        );

        for (const [modelKey, space, tolerance] of [
          ['random_forest_full_v1', 'probability', 1e-7],
          ['xgboost_full_v1', 'log_odds', 1e-5],
        ] as const) {
          const factors = (
            await get(
              `/api/v1/reservations/900000000101002/risk/factors?modelKey=${modelKey}&topK=5`,
            )
          ).json().data;
          assert.equal(factors.explanation.outputSpace, space);
          assert.equal(factors.explanation.factors.length, 5);
          assert.equal(factors.explanation.totalFeatureCount, 19);
          assert.ok(factors.explanation.additivityError <= tolerance);
          assert.equal(factors.persistedScore.sameModelIdentity, true);
          assert.ok(
            Math.abs(factors.probabilityNoShow - factors.persistedScore.probabilityNoShow) <= 1e-12,
          );
        }
      } finally {
        await ctx.close();
      }
    });

    it('6 POST concurrentes reales ⇒ 1 run y 2 scores; reinicio recupera todo sin volver a inferir', async () => {
      const ctx = buildSyntheticLocalApp({ ml: realMl(), sqlitePath });
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          ctx.app.inject({
            method: 'POST',
            url: '/api/v1/reservations/900000000101009/predictions',
            headers: AUTH_HEADERS,
            payload: { mode: 'compare' },
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 200, 200, 200, 200, 201]);
      await ctx.close();

      const local = new DatabaseSync(sqlitePath, { readOnly: true });
      const runs = local
        .prepare(
          "SELECT count(*) AS n FROM prediction_runs WHERE reservation_id = '900000000101009'",
        )
        .get()?.n;
      const results = local
        .prepare(
          "SELECT count(*) AS n FROM prediction_model_results WHERE reservation_id = '900000000101009'",
        )
        .get()?.n;
      local.close();
      assert.deepEqual([runs, results], [1, 2]);

      const restarted = buildSyntheticLocalApp({ ml: realMl(), sqlitePath });
      const risk = (
        await restarted.app.inject({
          method: 'GET',
          url: '/api/v1/reservations/900000000101003/risk',
          headers: AUTH_HEADERS,
        })
      ).json().data;
      assert.deepEqual(
        risk.models.map((m: { experimentalRisk: { level: string } }) => m.experimentalRisk.level),
        ['MEDIUM', 'HIGH'],
      );
      const replay = await restarted.app.inject({
        method: 'POST',
        url: '/api/v1/reservations/900000000101003/predictions',
        headers: AUTH_HEADERS,
        payload: { mode: 'compare' },
      });
      assert.equal(replay.json().data.run.replayed, true);
      await restarted.close();
    });
  },
);
