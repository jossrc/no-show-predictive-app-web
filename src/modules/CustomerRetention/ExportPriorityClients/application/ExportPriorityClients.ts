import type { Clock } from '../../../../shared/time/Clock.js';
import {
  priorityClientCsvFilename,
  priorityClientCsvRow,
  PRIORITY_CLIENT_CSV_HEADERS,
  toCsvLine,
  UTF8_BOM,
  type CsvDelimiter,
} from '../../Shared/export/PriorityClientCsv.js';
import type {
  PriorityClientPage,
  PriorityClientQuery,
  ResolvedPriorityClientQuery,
} from '../../Shared/query/PriorityClientQuery.js';
import type { ExportPriorityClientsInput } from './input/ExportPriorityClientsInput.js';
import type { ExportPriorityClientsResult } from './result/ExportPriorityClientsResult.js';

/** Tamaño de lote: acota memoria y consultas por iteración, sin depender de la paginación HTTP. */
export const EXPORT_BATCH_SIZE = 500;

/**
 * Exportación CSV del listado de clientes prioritarios con EXACTAMENTE la misma consulta
 * (PriorityClientQuery), filtros y orden: recorre todas las páginas por keyset en lotes y las
 * emite en streaming. El primer lote se resuelve antes de responder, de modo que los errores de
 * validación o de disponibilidad conservan el contrato JSON de errores.
 */
export class ExportPriorityClients {
  constructor(
    private readonly query: PriorityClientQuery,
    private readonly clock: Clock,
    private readonly batchSize: number = EXPORT_BATCH_SIZE,
  ) {}

  async execute(input: ExportPriorityClientsInput): Promise<ExportPriorityClientsResult> {
    const generatedAt = this.clock.now();
    const resolved = await this.query.resolve(input.filters, generatedAt);
    const first = await this.query.page(resolved, null, this.batchSize);
    return {
      filename: priorityClientCsvFilename(input.filters.modelKey, generatedAt),
      content: this.lines(resolved, first, input.delimiter),
    };
  }

  private async *lines(
    query: ResolvedPriorityClientQuery,
    first: PriorityClientPage,
    delimiter: CsvDelimiter,
  ): AsyncGenerator<string> {
    yield UTF8_BOM + toCsvLine(PRIORITY_CLIENT_CSV_HEADERS, delimiter);
    let page = first;
    for (;;) {
      if (page.items.length > 0) {
        yield page.items.map((item) => toCsvLine(priorityClientCsvRow(item), delimiter)).join('');
      }
      if (!page.hasMore || !page.last) return;
      page = await this.query.page(query, page.last, this.batchSize);
    }
  }
}
