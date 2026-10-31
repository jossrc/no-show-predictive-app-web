import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachedResearchPolicyCatalog } from '../../../../../src/infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import type { MlResearchPolicyCatalog } from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { MlResearchPolicyUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlResearchPolicyUnavailableException.js';
import { loadMlGolden } from '../../../../helpers/LoadFixture.js';

const available = () => loadMlGolden<MlResearchPolicyCatalog>('golden_v2_risk_policy');
const unavailable = () =>
  loadMlGolden<MlResearchPolicyCatalog>('golden_v2_risk_policy_unavailable');
const context = { requestId: 'catalog-test' };

function client(responses: Array<() => MlResearchPolicyCatalog>) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getResearchPolicy: async () => {
      const next = responses[Math.min(calls, responses.length - 1)]!;
      calls += 1;
      return next();
    },
  };
}

describe('CachedResearchPolicyCatalog', () => {
  it('cachea por TTL y comparte una sola carga concurrente', async () => {
    let now = 0;
    const fake = client([available]);
    const catalog = new CachedResearchPolicyCatalog(fake, {
      ttlMs: 60_000,
      expectedPolicyHashes: [],
      nowMs: () => now,
    });
    await Promise.all([catalog.getCatalog(context), catalog.getCatalog(context)]);
    assert.equal(fake.calls, 1);
    now = 59_999;
    await catalog.getCatalog(context);
    assert.equal(fake.calls, 1);
    now = 60_000;
    await catalog.getCatalog(context);
    assert.equal(fake.calls, 2);
  });

  it('requirePolicies devuelve la política de cada modelo por su hash publicado', async () => {
    const catalog = new CachedResearchPolicyCatalog(client([available]), {
      ttlMs: 1000,
      expectedPolicyHashes: [],
    });
    const policies = await catalog.requirePolicies(context);
    assert.equal(
      policies.get('random_forest_full_v1')?.policy_hash,
      '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
    );
    assert.equal(
      policies.get('xgboost_full_v1')?.policy_hash,
      '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032',
    );
  });

  it('UNAVAILABLE ⇒ 503 RESEARCH_RISK_POLICY_NOT_READY con la razón tipada; reintenta pronto', async () => {
    let now = 0;
    const fake = client([unavailable, available]);
    const catalog = new CachedResearchPolicyCatalog(fake, {
      ttlMs: 60_000,
      expectedPolicyHashes: [],
      nowMs: () => now,
    });
    await assert.rejects(
      () => catalog.requirePolicies(context),
      (error: unknown) =>
        error instanceof MlResearchPolicyUnavailableException &&
        error.code === 'RESEARCH_RISK_POLICY_NOT_READY' &&
        error.reason === 'disabled',
    );
    now = 5_000;
    const policies = await catalog.requirePolicies(context);
    assert.equal(policies.size, 2);
    assert.equal(fake.calls, 2);
  });

  it('allowlist de hashes: una política no esperada se rechaza (not_allowlisted)', async () => {
    const strict = new CachedResearchPolicyCatalog(client([available]), {
      ttlMs: 1000,
      expectedPolicyHashes: ['1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74'],
    });
    await assert.rejects(
      () => strict.requirePolicies(context),
      (error: unknown) =>
        error instanceof MlResearchPolicyUnavailableException && error.reason === 'not_allowlisted',
    );

    const pinned = new CachedResearchPolicyCatalog(client([available]), {
      ttlMs: 1000,
      expectedPolicyHashes: [
        '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74',
        '208c706d839b7c8b71134cd225da4bc1bb935c5d4bd06cbb898a8d8f84ee7032',
      ],
    });
    assert.equal((await pinned.requirePolicies(context)).size, 2);
  });

  it('invalidate fuerza recarga', async () => {
    const fake = client([available]);
    const catalog = new CachedResearchPolicyCatalog(fake, {
      ttlMs: 60_000,
      expectedPolicyHashes: [],
    });
    await catalog.getCatalog(context);
    catalog.invalidate();
    await catalog.getCatalog(context);
    assert.equal(fake.calls, 2);
  });
});
