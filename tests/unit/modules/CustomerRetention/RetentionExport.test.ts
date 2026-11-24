import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRIORITY_CLIENT_CSV_HEADERS,
  toSafeCsvCell,
  UTF8_BOM,
} from '../../../../src/modules/CustomerRetention/Shared/export/PriorityClientCsv.js';
import { AUTH_HEADERS } from '../../../helpers/BuildTestApp.js';
import {
  buildRetentionApp,
  createRetentionContext,
  filters,
  hoursFromNow,
  scoreReservation,
  seedContact,
} from '../../../helpers/RetentionTestContext.js';

/** Identificador de 18 dígitos (> Number.MAX_SAFE_INTEGER). */
const LARGE_ID = '987654321098765432';

async function eligibleScenario(count: number, exportBatchSize = 2) {
  const ctx = createRetentionContext({ exportBatchSize });
  for (let index = 1; index <= count; index += 1) {
    const id = index === count ? LARGE_ID : `90000000090${String(index).padStart(4, '0')}`;
    ctx.addSourceReservation({ reservationId: id, appointmentAt: hoursFromNow(index * 5) });
    await scoreReservation(ctx.store, id, { model: 'xgb', probability: 0.5 + index / 100 });
  }
  return ctx;
}

async function readAll(content: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of content) text += chunk;
  return text;
}

/** Parser mínimo para las pruebas: celdas siempre entrecomilladas, sin saltos internos. */
function parseCsv(text: string, delimiter = ','): string[][] {
  return text
    .replace(UTF8_BOM, '')
    .split('\r\n')
    .filter(Boolean)
    .map((line) =>
      line
        .slice(1, -1)
        .split(`"${delimiter}"`)
        .map((cell) => cell.replaceAll('""', '"')),
    );
}

describe('Exportación de clientes prioritarios (CSV)', () => {
  it('exporta el 100 % de las filas filtradas por lotes, con el mismo orden que el listado', async () => {
    const ctx = await eligibleScenario(5, 2);
    const order = filters({ sort: 'probabilityNoShow', direction: 'desc' });
    const firstPage = await ctx.list.execute({ filters: order, limit: 1, cursor: null });
    assert.equal(firstPage.items.length, 1);
    assert.notEqual(firstPage.nextCursor, null);

    const exported = await ctx.exporter.execute({ filters: order, delimiter: 'comma' });
    const [header, ...rows] = parseCsv(await readAll(exported.content));
    assert.deepEqual(header, [...PRIORITY_CLIENT_CSV_HEADERS]);
    assert.equal(rows.length, 5, 'todas las filas, no solo la página');

    const listed = await ctx.list.execute({ filters: order, limit: 100, cursor: null });
    assert.deepEqual(
      rows.map((row) => row[1]),
      listed.items.map((item) => item.reservation.reservationId),
    );
    assert.ok(
      rows.some((row) => row[1] === LARGE_ID),
      'identificador grande exacto como texto',
    );
    assert.match(
      exported.filename,
      /^clientes-prioritarios-retencion_xgboost_full_v1_20261110-1000\.csv$/,
    );

    // Mismos filtros: sin filas pendientes no hay nada que exportar.
    await seedContact(ctx, '900000000900001');
    const sent = await ctx.exporter.execute({
      filters: filters({ retentionStatus: 'CAMPAIGN_SENT' }),
      delimiter: 'semicolon',
    });
    const sentRows = parseCsv(await readAll(sent.content), ';').slice(1);
    assert.deepEqual(
      sentRows.map((row) => [row[1], row[10]]),
      [['900000000900001', 'Campaña de retención enviada']],
    );
  });

  it('serializa de forma segura: BOM UTF-8, cabeceras de descarga y fórmulas neutralizadas', async () => {
    const cases: Array<[string | number | null, string]> = [
      ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
      ['+1', `"'+1"`],
      ['-2', `"'-2"`],
      ['@SUM(A1)', `"'@SUM(A1)"`],
      ['\tcmd', `"'\tcmd"`],
      ['Campaña de retención enviada', '"Campaña de retención enviada"'],
      [LARGE_ID, `"${LARGE_ID}"`],
      [0.4351, '"0.4351"'],
      [null, '""'],
    ];
    for (const [value, expected] of cases)
      assert.equal(toSafeCsvCell(value), expected, String(value));

    const ctx = await eligibleScenario(3);
    const app = buildRetentionApp(ctx);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/retention/priority-clients/export?modelKey=xgboost_full_v1&delimiter=semicolon',
        headers: AUTH_HEADERS,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-type'], 'text/csv; charset=utf-8');
      assert.equal(
        response.headers['content-disposition'],
        'attachment; filename="clientes-prioritarios-retencion_xgboost_full_v1_20261110-1000.csv"',
      );
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.ok(response.headers['x-request-id']);
      assert.ok(response.rawPayload.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
      const rows = parseCsv(response.body, ';');
      assert.equal(rows.length, 4);
      assert.ok(rows.every((row) => row.length === PRIORITY_CLIENT_CSV_HEADERS.length));
      assert.doesNotMatch(response.body, /nombre|tel[eé]fono|correo|documento/i);

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/v1/retention/priority-clients/export?delimiter=tab',
        headers: AUTH_HEADERS,
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.json().error.code, 'REQUEST_VALIDATION_ERROR');
      const unauthorized = await app.inject({
        method: 'GET',
        url: '/api/v1/retention/priority-clients/export',
      });
      assert.equal(unauthorized.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
