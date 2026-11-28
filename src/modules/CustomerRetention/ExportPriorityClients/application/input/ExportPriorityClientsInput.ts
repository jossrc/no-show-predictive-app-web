import type { PriorityClientFilters } from '../../../Shared/query/PriorityClientQuery.js';
import type { CsvDelimiter } from '../../../Shared/export/PriorityClientCsv.js';

export interface ExportPriorityClientsInput {
  readonly filters: PriorityClientFilters;
  readonly delimiter: CsvDelimiter;
}
