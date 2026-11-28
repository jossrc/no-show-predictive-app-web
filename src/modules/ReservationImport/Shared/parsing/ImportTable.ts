/**
 * Tabla neutral leída de un CSV o de la primera hoja de un .xlsx. Las celdas numéricas de Excel
 * conservan su texto crudo (`<v>`): nunca se convierten a Number aquí, para no perder precisión
 * en identificadores grandes; la normalización decide por tipo de columna.
 */
export type ImportCell =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly raw: string };

export interface ImportTableRow {
  /** Fila del archivo contando la cabecera como fila 1. */
  readonly rowNumber: number;
  readonly cells: readonly (ImportCell | null)[];
}

export type ImportFileFormat = 'CSV' | 'XLSX';

export interface ImportTable {
  readonly format: ImportFileFormat;
  readonly headers: readonly string[];
  readonly rows: readonly ImportTableRow[];
  /** Sistema de fechas 1904 del libro (solo .xlsx). */
  readonly date1904: boolean;
}

export interface ImportFileLimits {
  readonly maxFileBytes: number;
  readonly maxRows: number;
}

export function textCell(text: string): ImportCell {
  return { kind: 'text', text };
}

export function isBlankCell(cell: ImportCell | null | undefined): boolean {
  return cell === null || cell === undefined || (cell.kind === 'text' && cell.text.trim() === '');
}
