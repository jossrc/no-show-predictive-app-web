import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { HttpMlPredictionClient } from '../../../../../src/infrastructure/http/ml/HttpMlPredictionClient.js';
import type { MlCompareRequest } from '../../../../../src/infrastructure/http/ml/MlContractTypes.js';
import { PREDICTOR_COLUMNS } from '../../../../../src/infrastructure/http/ml/MlFeatureContract.js';
import { MlTimeoutPolicy } from '../../../../../src/infrastructure/http/ml/MlTimeoutPolicy.js';
import { MlContractViolationException } from '../../../../../src/infrastructure/http/ml/errors/MlContractViolationException.js';
import { MlRateLimitedException } from '../../../../../src/infrastructure/http/ml/errors/MlRateLimitedException.js';
import { MlTimeoutException } from '../../../../../src/infrastructure/http/ml/errors/MlTimeoutException.js';
import { MlUnavailableException } from '../../../../../src/infrastructure/http/ml/errors/MlUnavailableException.js';
import { CircuitBreaker } from '../../../../../src/infrastructure/resilience/CircuitBreaker.js';
import { ConcurrencyLimiter } from '../../../../../src/infrastructure/resilience/ConcurrencyLimiter.js';
import { loadJsonFixture, loadMlGolden } from '../../../../helpers/LoadFixture.js';

const SERVICE_KEY = 'svc-key-for-tests-only-0123456789abcdefghij';

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

type Handler = (request: CapturedRequest, response: ServerResponse) => void;

let server: Server;
let baseUrl: URL;
let handler: Handler;
const received: CapturedRequest[] = [];

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const request: MlCompareRequest = {
  feature_version: 'BOOKING_BASELINE_V1',
  feature_context: {
    snapshot_type: 'booking_creation',
    builder_version: 'risk_features_builder_v1',
  },
  features: loadJsonFixture<{ request: MlCompareRequest }>(
    'fixtures/ml/synthetic_compare_request.json',
  ).request.features,
};

function makeClient(
  overrides: {
    inference?: ConcurrencyLimiter;
    breaker?: CircuitBreaker;
    timeoutMs?: number;
    logs?: string[];
    base?: URL;
  } = {},
) {
  const logs = overrides.logs ?? [];
  return new HttpMlPredictionClient({
    baseUrl: overrides.base ?? baseUrl,
    serviceKey: SERVICE_KEY,
    timeoutPolicy: new MlTimeoutPolicy({
      defaultMs: overrides.timeoutMs ?? 2000,
      explanationMs: 2000,
    }),
    inferenceLimiter: overrides.inference ?? new ConcurrencyLimiter(4, 4),
    explanationLimiter: new ConcurrencyLimiter(1, 2),
    circuitBreaker:
      overrides.breaker ?? new CircuitBreaker({ failureThreshold: 50, cooldownMs: 1000 }),
    batchMaxItems: 32,
    logger: {
      info: (payload, message) => void logs.push(JSON.stringify({ payload, message })),
      warn: (payload, message) => void logs.push(JSON.stringify({ payload, message })),
    },
  });
}

before(async () => {
  server = createServer((incoming, response) => {
    let body = '';
    incoming.on('data', (chunk) => (body += chunk));
    incoming.on('end', () => {
      const captured = {
        method: incoming.method,
        url: incoming.url,
        headers: incoming.headers,
        body,
      };
      received.push(captured);
      handler(captured, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received.length = 0;
  handler = (_req, res) => json(res, 200, loadMlGolden('golden_compare'));
});

describe('HttpMlPredictionClient contra servidor HTTP mock (loopback)', () => {
  it('compare: ruta de contrato, clave SOLO hacia Python, X-Request-ID opaco y 19 claves canónicas', async () => {
    const result = await makeClient().compare(request, { requestId: 'req-opaque-1' });
    assert.equal(result.results[1].model_key, 'xgboost_full_v1');

    const sent = received[0]!;
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, '/internal/v1/predictions/compare');
    assert.equal(sent.headers['x-service-api-key'], SERVICE_KEY);
    assert.equal(sent.headers['x-request-id'], 'req-opaque-1');
    const body = JSON.parse(sent.body);
    assert.deepEqual(Object.keys(body.features), [...PREDICTOR_COLUMNS]);
    for (const forbidden of ['target', 'client_id', 'appointment_id', 'reservation_id']) {
      assert.ok(!(forbidden in body.features) && !(forbidden in body), forbidden);
    }
  });

  it('el cuerpo solo contiene campos del contrato aunque la entrada traiga extras (IDs, target)', async () => {
    handler = (req, res) =>
      json(
        res,
        200,
        loadMlGolden(
          req.url === '/internal/v1/predictions/batch' ? 'golden_batch_compare' : 'golden_compare',
        ),
      );
    const polluted = {
      ...request,
      reservation_id: '900000000001001',
      target: 1,
    } as unknown as MlCompareRequest;
    await makeClient().compare(polluted, { requestId: 'r' });
    await makeClient().batch(
      {
        ...polluted,
        mode: 'compare',
        items: [{ features: request.features }, { features: request.features }],
      },
      { requestId: 'r' },
    );
    assert.deepEqual(Object.keys(JSON.parse(received[0]!.body)).sort(), [
      'feature_context',
      'feature_version',
      'features',
    ]);
    assert.deepEqual(Object.keys(JSON.parse(received[1]!.body)).sort(), [
      'feature_context',
      'feature_version',
      'items',
      'mode',
    ]);
  });

  it('predict/explain/models/ready/batch usan las rutas y validaciones correctas', async () => {
    const goldenFor: Record<string, string> = {
      '/internal/v1/predictions': 'golden_predict_xgb',
      '/internal/v1/predictions/explain': 'golden_explain_rf',
      '/internal/v1/models': 'golden_models',
      '/health/ready': 'golden_ready',
      '/internal/v1/predictions/batch': 'golden_batch_single',
    };
    handler = (req, res) => json(res, 200, loadMlGolden(goldenFor[req.url ?? '']!));
    const client = makeClient();
    const ctx = { requestId: 'r' };

    assert.equal(
      (await client.predict({ ...request, model_key: 'xgboost_full_v1' }, ctx)).model_key,
      'xgboost_full_v1',
    );
    assert.equal(
      (await client.explain({ ...request, model_key: 'random_forest_full_v1', top_k: 5 }, ctx))
        .explanation.top_k,
      5,
    );
    assert.equal((await client.getModels(ctx)).default_model_key, 'random_forest_full_v1');
    assert.equal((await client.ready(ctx)).status, 'ready');
    const items = [{ features: request.features }, { features: request.features }];
    assert.equal(
      (
        await client.batch(
          { ...request, mode: 'single', model_key: 'random_forest_full_v1', items },
          ctx,
        )
      ).count,
      2,
    );

    const readyCall = received.find((r) => r.url === '/health/ready')!;
    assert.equal(readyCall.headers['x-service-api-key'], undefined, 'readiness no requiere clave');
  });

  it('respuestas de error HTTP de Python se mapean a errores estables', async () => {
    const cases: Array<[number, unknown, (e: unknown) => boolean]> = [
      [
        401,
        loadMlGolden('golden_error_401'),
        (e) => e instanceof MlUnavailableException && e.code === 'ML_CREDENTIAL_REJECTED',
      ],
      [
        429,
        { error: { code: 'RATE_LIMITED', message: 'x', details: [] }, request_id: 'r' },
        (e) => e instanceof MlRateLimitedException,
      ],
      [
        503,
        { error: { code: 'MODEL_NOT_READY', message: 'x', details: [] }, request_id: 'r' },
        (e) => e instanceof MlUnavailableException,
      ],
      [
        413,
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'x', details: [] }, request_id: 'r' },
        (e) => e instanceof MlContractViolationException,
      ],
    ];
    for (const [status, body, check] of cases) {
      handler = (_req, res) => json(res, status, body);
      await assert.rejects(
        makeClient().compare(request, { requestId: 'r' }),
        check,
        String(status),
      );
    }
  });

  it('200 malformado: content-type incorrecto, JSON con NaN o fuera de contrato ⇒ ML_CONTRACT_VIOLATION', async () => {
    const bodies: Array<[string, string]> = [
      ['text/html', '<html>ok</html>'],
      ['application/json', '{"probability_no_show": NaN}'],
      [
        'application/json',
        JSON.stringify({ ...loadMlGolden('golden_compare'), risk_level: 'LOW' }),
      ],
    ];
    for (const [type, body] of bodies) {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': type });
        res.end(body);
      };
      await assert.rejects(
        makeClient().compare(request, { requestId: 'r' }),
        MlContractViolationException,
        type,
      );
    }
  });

  it('timeout ⇒ ML_TIMEOUT (sin reintento automático: una sola petición enviada)', async () => {
    handler = (_req, res) => setTimeout(() => json(res, 200, loadMlGolden('golden_compare')), 300);
    await assert.rejects(
      makeClient({ timeoutMs: 50 }).compare(request, { requestId: 'r' }),
      MlTimeoutException,
    );
    assert.equal(received.length, 1);
  });

  it('conexión rechazada ⇒ ML_UNAVAILABLE', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const client = makeClient({ base: new URL(`http://127.0.0.1:${port}`) });
    await assert.rejects(
      client.compare(request, { requestId: 'r' }),
      (e) => e instanceof MlUnavailableException && e.code === 'ML_UNAVAILABLE',
    );
  });

  it('backpressure local: cupo y cola agotados ⇒ ML_RATE_LIMITED sin contactar a Python', async () => {
    handler = (_req, res) => setTimeout(() => json(res, 200, loadMlGolden('golden_compare')), 100);
    const client = makeClient({ inference: new ConcurrencyLimiter(1, 0) });
    const first = client.compare(request, { requestId: 'a' });
    await assert.rejects(
      client.compare(request, { requestId: 'b' }),
      (e) => e instanceof MlRateLimitedException && e.metadata?.origin === 'LOCAL_BACKPRESSURE',
    );
    await first;
    assert.equal(received.length, 1);
  });

  it('circuit breaker abre tras fallos 5xx y deja de llamar (sin tormenta de peticiones)', async () => {
    handler = (_req, res) =>
      json(res, 500, {
        error: { code: 'INFERENCE_FAILED', message: 'x', details: [] },
        request_id: 'r',
      });
    const client = makeClient({
      breaker: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 }),
    });
    for (let i = 0; i < 2; i += 1) {
      await assert.rejects(client.compare(request, { requestId: 'r' }), MlUnavailableException);
    }
    await assert.rejects(
      client.compare(request, { requestId: 'r' }),
      (e) => e instanceof MlUnavailableException && e.code === 'ML_CIRCUIT_OPEN',
    );
    assert.equal(received.length, 2);
  });

  it('batch: límite de items antes de enviar e índices corruptos rechazan todo el lote', async () => {
    const client = makeClient();
    const items = Array.from({ length: 33 }, () => ({ features: request.features }));
    await assert.rejects(
      client.batch({ ...request, mode: 'compare', items }, { requestId: 'r' }),
      MlContractViolationException,
    );
    assert.equal(received.length, 0);

    const corrupted = loadMlGolden<{ results: Array<{ index: number }> }>('golden_batch_compare');
    corrupted.results[1]!.index = 5;
    handler = (_req, res) => json(res, 200, corrupted);
    await assert.rejects(
      client.batch({ ...request, mode: 'compare', items: items.slice(0, 2) }, { requestId: 'r' }),
      MlContractViolationException,
    );
  });

  it('logs estructurados sin clave de servicio, cabeceras ni valores de features', async () => {
    const logs: string[] = [];
    await makeClient({ logs }).compare(request, { requestId: 'log-req' });
    handler = (_req, res) => json(res, 401, loadMlGolden('golden_error_401'));
    await assert.rejects(makeClient({ logs }).compare(request, { requestId: 'log-req-2' }));
    const text = logs.join('\n');
    assert.match(text, /"contractPath":"\/internal\/v1\/predictions\/compare"/);
    assert.match(text, /"requestId":"log-req"/);
    assert.doesNotMatch(text, new RegExp(SERVICE_KEY));
    assert.doesNotMatch(text, /x-service-api-key|age_at_booking|clinic_id/i);
  });

  it('redirecciones no se siguen (destino fijo, anti-SSRF)', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest' });
      res.end();
    };
    await assert.rejects(makeClient().compare(request, { requestId: 'r' }), MlUnavailableException);
    assert.equal(received.length, 1);
  });
});
