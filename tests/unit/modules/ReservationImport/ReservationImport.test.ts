import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvalidImportFileException } from '../../../../src/modules/ReservationImport/Shared/errors/InvalidImportFileException.js';
import { BookingSnapshotResolver } from '../../../../src/modules/ReservationRisk/Shared/calculation/BookingSnapshotResolver.js';
import { AUTH_HEADERS } from '../../../helpers/BuildTestApp.js';
import { buildXlsxWorkbook } from '../../../helpers/BuildXlsxWorkbook.js';
import {
  buildRetentionApp,
  createRetentionContext,
  IMPORT_HEADERS,
  importInput,
  importRow,
  MODE,
  multipartBody,
  toCsv,
} from '../../../helpers/RetentionTestContext.js';

/** Identificador > Number.MAX_SAFE_INTEGER: debe conservarse como cadena exacta. */
const LARGE_ID = '987654321098765432';

function contextWithReferences() {
  const ctx = createRetentionContext();
  ctx.references.addClient('900000000702001');
  ctx.references.addClient('900000000702002');
  return ctx;
}

function codesOf(
  result: Awaited<ReturnType<ReturnType<typeof createRetentionContext>['importer']['execute']>>,
) {
  return result.rejections.flatMap((rejection) => rejection.errors.map((error) => error.code));
}

describe('Incorporación masiva de reservas', () => {
  it('procesa archivos CSV y Excel válidos y persiste identificadores exactos como texto', async (t) => {
    const rows = [
      importRow({ DiaryGID: '900000000701001' }),
      importRow({ DiaryGID: LARGE_ID, DiaryGClientID: '900000000702002', DiaryGFWA: '' }),
    ];
    const files = {
      csv: toCsv(rows, ';'),
      xlsx: buildXlsxWorkbook([
        [...IMPORT_HEADERS],
        ...rows.map((row) =>
          IMPORT_HEADERS.map((header) =>
            // Fecha/hora como serie numérica de Excel (2026-11-11 = 46337) para validar su conversión.
            header === 'DiaryGDate' ? { number: '46337' } : row[header] === '' ? null : row[header],
          ),
        ),
      ]),
    };

    for (const [extension, data] of Object.entries(files)) {
      await t.test(extension, async () => {
        const ctx = contextWithReferences();
        const result = await ctx.importer.execute(importInput(`reservas.${extension}`, data));

        assert.equal(result.batch.fileFormat, extension.toUpperCase());
        assert.equal(result.batch.status, 'COMPLETED');
        assert.deepEqual(
          [result.batch.totalRows, result.batch.acceptedRows, result.batch.rejectedRows],
          [2, 2, 0],
        );
        const stored = await ctx.imports.findByReservationId(LARGE_ID);
        assert.equal(stored?.reservationId, LARGE_ID);
        assert.equal(stored?.fwaFlag, null, 'opcional vacío ⇒ null, nunca un valor inventado');
        assert.equal(stored?.appointmentAt.toISOString(), '2026-11-11T15:00:00.000Z');
        assert.equal(stored?.bookingCreatedAt.toISOString(), '2026-11-05T14:30:00.000Z');
        assert.equal(stored?.classificationCutoffAt.toISOString(), ctx.clock.now().toISOString());
        assert.deepEqual(
          result.accepted.map((row) => row.rowNumber),
          [2, 3],
        );
      });
    }
  });

  it('rechaza archivos vacíos, no admitidos, inseguros o sin columnas obligatorias sin registrar lote', async () => {
    const header = IMPORT_HEADERS.filter((name) => name !== 'cantidad_reprogramaciones');
    const cases: Array<[string, string, Uint8Array]> = [
      ['EMPTY_FILE', 'vacio.csv', new Uint8Array()],
      ['UNSUPPORTED_FILE_FORMAT', 'reservas.xls', toCsv([importRow()])],
      ['FILE_CONTENT_MISMATCH', 'reservas.xlsx', toCsv([importRow()])],
      ['INVALID_FILE_ENCODING', 'latin1.csv', new Uint8Array([0x44, 0x69, 0x61, 0xf1, 0x0a])],
      [
        'MISSING_REQUIRED_COLUMNS',
        'reservas.csv',
        new TextEncoder().encode(`${header.join(',')}\n1,2,3\n`),
      ],
      ['NO_DATA_ROWS', 'cabecera.csv', new TextEncoder().encode(`${IMPORT_HEADERS.join(',')}\n`)],
      [
        'SPREADSHEET_FORMULAS_NOT_ALLOWED',
        'formula.xlsx',
        buildXlsxWorkbook([[...IMPORT_HEADERS], [{ formula: 'HYPERLINK("http://x")' }]]),
      ],
      [
        'SPREADSHEET_MACROS_NOT_ALLOWED',
        'macro.xlsx',
        buildXlsxWorkbook([[...IMPORT_HEADERS]], { withMacros: true }),
      ],
      [
        'SPREADSHEET_EXTERNAL_CONTENT_NOT_ALLOWED',
        'externo.xlsx',
        buildXlsxWorkbook([[...IMPORT_HEADERS]], { withExternalLink: true }),
      ],
    ];

    for (const [code, filename, data] of cases) {
      const ctx = contextWithReferences();
      await assert.rejects(
        ctx.importer.execute(importInput(filename, data)),
        (error: unknown) => error instanceof InvalidImportFileException && error.code === code,
        code,
      );
      assert.equal(ctx.imports.batches.length, 0, `${code}: sin lote`);
      assert.equal(ctx.imports.rows.size, 0, `${code}: sin reservas`);
    }

    // Contrato HTTP: errores del ARCHIVO (sin lote) separados de los errores por fila.
    const ctx = contextWithReferences();
    const app = buildRetentionApp(ctx);
    const post = (
      body: { payload: Buffer | string; headers: Record<string, string> },
      auth = true,
    ) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/reservation-imports',
        payload: body.payload,
        headers: { ...(auth ? AUTH_HEADERS : {}), ...body.headers },
      });
    try {
      const csv = toCsv([importRow()]);
      const cases: Array<[string, Awaited<ReturnType<typeof post>>, number, string]> = [
        ['sin credencial', await post(multipartBody('r.csv', csv), false), 401, 'UNAUTHORIZED'],
        [
          'JSON',
          await post({ payload: '{}', headers: { 'content-type': 'application/json' } }),
          415,
          'UNSUPPORTED_MEDIA_TYPE',
        ],
        [
          'campo distinto',
          await post(multipartBody('r.csv', csv, { field: 'archivo' })),
          422,
          'IMPORT_FILE_REQUIRED',
        ],
        [
          'campo adicional',
          await post(multipartBody('r.csv', csv, { extraFields: { nota: 'x' } })),
          413,
          'PAYLOAD_TOO_LARGE',
        ],
        [
          'tamaño excedido',
          await post(multipartBody('r.csv', new Uint8Array(70 * 1024).fill(65))),
          413,
          'PAYLOAD_TOO_LARGE',
        ],
        [
          'macros',
          await post(
            multipartBody('m.xlsx', buildXlsxWorkbook([[...IMPORT_HEADERS]], { withMacros: true })),
          ),
          422,
          'SPREADSHEET_MACROS_NOT_ALLOWED',
        ],
      ];
      for (const [name, response, status, code] of cases) {
        assert.equal(response.statusCode, status, name);
        assert.equal(response.json().error.code, code, name);
        assert.ok(response.json().requestId, name);
      }
      assert.equal(ctx.imports.batches.length, 0);
    } finally {
      await app.close();
    }
  });

  it('procesa parcialmente: cuenta aceptadas/rechazadas y explica cada fila sin devolver sus valores', async () => {
    const ctx = contextWithReferences();
    ctx.addSourceReservation({ reservationId: '900000000701009' });
    const rows = [
      importRow({ DiaryGID: '900000000701001' }),
      importRow({ DiaryGID: '900000000701002', DiaryGDate: '31/02/2026' }),
      importRow({ DiaryGID: '900000000701003', DiaryGClinicID: '77' }),
      importRow({ DiaryGID: '900000000701004', DiaryGClientID: '900000000709999' }),
      importRow({ DiaryGID: '900000000701005', DiaryZoneIDs: '900101|555555' }),
      importRow({ DiaryGID: '900000000701009' }),
      importRow({ DiaryGID: '900000000701006', DiaryGDate: '2026-11-09' }),
      importRow({ DiaryGID: '900000000701007', DiaryGCreated: '2026-11-12 08:00' }),
      importRow({ DiaryGID: '=1+1', DiaryGClientID: '9.00000000702001E+14' }),
      importRow({ DiaryGID: '900000000701001' }),
      importRow({ DiaryGID: '900000000701008', DiaryGNotAttended: '-1', DiaryGEnd: '09:00' }),
    ];
    const result = await ctx.importer.execute(importInput('mixto.csv', toCsv(rows)));

    assert.equal(result.batch.status, 'COMPLETED_WITH_REJECTIONS');
    assert.deepEqual(
      [result.batch.totalRows, result.batch.acceptedRows, result.batch.rejectedRows],
      [11, 1, 10],
    );
    assert.deepEqual(result.accepted, [{ rowNumber: 2, reservationId: '900000000701001' }]);
    assert.deepEqual(codesOf(result).sort(), [
      'APPOINTMENT_NOT_FUTURE',
      'BOOKING_CREATED_IN_FUTURE',
      'BOOKING_NOT_BEFORE_APPOINTMENT',
      'CLIENT_NOT_FOUND',
      'DUPLICATE_ROW_IN_FILE',
      'END_BEFORE_START',
      'INVALID_DATE',
      'INVALID_IDENTIFIER',
      'INVALID_IDENTIFIER',
      'PRODUCT_NOT_FOUND',
      'RESERVATION_EXISTS_IN_SOURCE',
      'UNKNOWN_CLINIC',
    ]);
    const formulaRow = result.rejections.find((rejection) => rejection.rowNumber === 10);
    assert.equal(formulaRow?.reservationId, null, 'un identificador inválido nunca se devuelve');
    assert.equal(ctx.imports.rows.size, 1);
    assert.equal(ctx.imports.rejections.length, 10, 'motivos trazados por fila en el lote');

    // Mismo archivo por HTTP: 201 con lote, conteos y motivos legibles por fila.
    const httpContext = contextWithReferences();
    httpContext.addSourceReservation({ reservationId: '900000000701009' });
    const app = buildRetentionApp(httpContext);
    try {
      const body = multipartBody('mixto.csv', toCsv(rows));
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/reservation-imports',
        payload: body.payload,
        headers: { ...AUTH_HEADERS, ...body.headers },
      });
      assert.equal(response.statusCode, 201);
      const { data } = response.json();
      assert.deepEqual(
        [data.status, data.totalRows, data.acceptedRows, data.rejectedRows],
        ['COMPLETED_WITH_REJECTIONS', 11, 1, 10],
      );
      assert.equal(data.predictionsGenerated, false);
      assert.equal(data.statusLabel, 'Procesado con filas rechazadas');
      const dateRow = data.rejectedRowDetails.find(
        (row: { rowNumber: number }) => row.rowNumber === 3,
      );
      assert.deepEqual(dateRow.errors, [
        {
          code: 'INVALID_DATE',
          field: 'DiaryGDate',
          message: 'Fecha inválida: use YYYY-MM-DD o DD/MM/YYYY',
        },
      ]);
      assert.doesNotMatch(
        response.body,
        /31\/02\/2026|=1\+1/,
        'los valores recibidos no se devuelven',
      );
      assert.ok(
        data.rejectionSummary.some((item: { code: string }) => item.code === 'UNKNOWN_CLINIC'),
      );
    } finally {
      await app.close();
    }
  });

  it('una reimportación nunca duplica ni reemplaza reservas (también ante una carga concurrente)', async () => {
    const ctx = contextWithReferences();
    const file = toCsv([importRow({ DiaryGID: '900000000701001' })]);
    await ctx.importer.execute(importInput('a.csv', file));

    const same = await ctx.importer.execute(importInput('a.csv', file));
    const changed = await ctx.importer.execute(
      importInput('b.csv', toCsv([importRow({ DiaryGID: '900000000701001', DiaryGEnd: '10:50' })])),
    );
    assert.deepEqual([same.batch.acceptedRows, same.batch.status], [0, 'NO_ROWS_ACCEPTED']);
    assert.deepEqual(codesOf(same), ['ALREADY_IMPORTED']);
    assert.deepEqual(codesOf(changed), ['ALREADY_IMPORTED_WITH_DIFFERENT_DATA']);
    assert.equal(ctx.imports.rows.size, 1);
    assert.equal(
      ctx.imports.rows.get('900000000701001')?.appointmentAt.toISOString(),
      '2026-11-11T15:00:00.000Z',
      'el registro original se conserva',
    );

    // Otra importación inserta la misma reserva entre la validación y el INSERT.
    const racing = createRetentionContext();
    racing.references.addClient('900000000702001');
    const first = createRetentionContext();
    first.references.addClient('900000000702001');
    await first.importer.execute(importInput('c.csv', file));
    racing.imports.racingInserts = [...first.imports.rows.values()];
    const raced = await racing.importer.execute(importInput('c.csv', file));
    assert.deepEqual([raced.batch.acceptedRows, raced.accepted.length], [0, 0]);
    assert.deepEqual(codesOf(raced), ['ALREADY_IMPORTED']);
  });

  it('las reservas aceptadas entran al listado, al detalle y a la evaluación predictiva sin fabricar evidencia', async () => {
    const ctx = contextWithReferences();
    await ctx.importer.execute(
      importInput(
        'r.csv',
        toCsv([
          importRow({ DiaryGID: '900000000701001' }),
          importRow({ DiaryGID: '900000000701002', DiaryGCreated: '2026-11-09 23:00' }),
          importRow({ DiaryGID: '900000000701003', cantidad_reprogramaciones: '2' }),
        ]),
      ),
    );
    ctx.addSourceReservation({
      reservationId: '900000000001001',
      appointmentAt: new Date('2026-11-11T14:00:00.000Z'),
    });

    const page = await ctx.reservations.list({
      startInclusive: new Date('2026-11-11T05:00:00.000Z'),
      endExclusive: new Date('2026-11-12T05:00:00.000Z'),
      status: 'SCHEDULED',
      clinicId: null,
      clinicScope: { kind: 'ALL_CLINICS' },
      sortField: 'appointmentAt',
      sortDirection: 'asc',
      modelKey: 'xgboost_full_v1',
      probabilityRange: null,
      experimentalPolicyHash: null,
      experimentalRiskLevel: null,
      snapshotEvidence: 'VERIFIED_BOOKING_SNAPSHOT',
      after: null,
      limit: 10,
    });
    assert.deepEqual(
      page.rows.map((row) => [row.reservation.reservationId, row.reservation.origin ?? 'SOURCE']),
      [
        ['900000000001001', 'SOURCE'],
        ['900000000701001', 'IMPORT'],
        ['900000000701002', 'IMPORT'],
        ['900000000701003', 'IMPORT'],
      ],
    );
    const detail = await ctx.reservations.findWithScores(
      '900000000701001',
      'VERIFIED_BOOKING_SNAPSHOT',
    );
    assert.equal(detail?.reservation.importBatchId, ctx.imports.batches[0]?.batchId);
    assert.deepEqual(detail?.scores, [], 'la importación no genera predicciones');

    const resolver = new BookingSnapshotResolver(ctx.store, ctx.evidence, MODE);
    const resolve = async (id: string) => resolver.resolve((await ctx.reservations.findById(id))!);
    const verified = await resolve('900000000701001');
    assert.equal(verified.kind, 'VERIFIED_SOURCE');
    if (verified.kind === 'VERIFIED_SOURCE') {
      assert.equal(verified.verified.predictionAt.toISOString(), '2026-11-05T14:30:00.000Z');
      assert.equal(verified.verified.clientBirthDate, '1990-05-10');
      assert.equal(verified.sourceIngestionBatchId, ctx.imports.batches[0]?.batchId);
    }
    // Creada después del último corte del historial: no se completa el historial con ceros.
    const uncovered = await resolve('900000000701002');
    assert.deepEqual(
      uncovered.kind === 'NOT_SCORABLE' ? uncovered.reasons.map((reason) => reason.code) : [],
      ['HISTORY_COVERAGE_INCOMPLETE'],
    );
    // Con copias de reprogramación y sin la versión original, no se acredita la foto al reservar.
    const rescheduled = await resolve('900000000701003');
    assert.deepEqual(
      rescheduled.kind === 'NOT_SCORABLE' ? rescheduled.reasons.map((reason) => reason.code) : [],
      ['RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT', 'SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
    );
  });
});
