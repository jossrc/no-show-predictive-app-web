export interface ExportPriorityClientsResult {
  readonly filename: string;
  /** CSV UTF-8 con BOM, generado por lotes acotados (todas las filas, no solo una página). */
  readonly content: AsyncIterable<string>;
}
