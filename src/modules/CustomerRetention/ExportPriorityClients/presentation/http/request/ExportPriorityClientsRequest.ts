import type { CsvDelimiter } from '../../../../Shared/export/PriorityClientCsv.js';
import type { PriorityClientFilterQuery } from '../../../../Shared/http/PriorityClientFilterQuery.js';

export interface ExportPriorityClientsQuery extends PriorityClientFilterQuery {
  delimiter: CsvDelimiter;
}

export interface ExportPriorityClientsRequest {
  Querystring: ExportPriorityClientsQuery;
}
