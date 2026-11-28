import { strToU8, zipSync } from 'fflate';

/** Celda de prueba: texto (inlineStr), número crudo de Excel o fórmula (para casos de rechazo). */
export type XlsxCell = string | { readonly number: string } | { readonly formula: string } | null;

export interface XlsxWorkbookOptions {
  readonly sheetName?: string;
  /** Agrega xl/vbaProject.bin y el content type de libro con macros. */
  readonly withMacros?: boolean;
  /** Agrega un vínculo externo (xl/externalLinks/externalLink1.xml). */
  readonly withExternalLink?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cellXml(cell: XlsxCell, reference: string): string {
  if (cell === null) return '';
  if (typeof cell === 'string') {
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
  }
  if ('number' in cell) return `<c r="${reference}"><v>${cell.number}</v></c>`;
  return `<c r="${reference}"><f>${escapeXml(cell.formula)}</f><v>0</v></c>`;
}

/**
 * Libro SpreadsheetML mínimo y válido (una hoja, cadenas en línea) generado SOLO con datos
 * sintéticos. Se usa en pruebas y para producir la plantilla de documentación.
 */
export function buildXlsxWorkbook(
  rows: readonly (readonly XlsxCell[])[],
  options: XlsxWorkbookOptions = {},
): Uint8Array {
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, columnIndex) => cellXml(cell, `${columnName(columnIndex)}${rowIndex + 1}`))
          .join('')}</row>`,
    )
    .join('');
  const mainType = options.withMacros
    ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(options.sheetName ?? 'Reservas')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  };
  if (options.withMacros) files['xl/vbaProject.bin'] = new Uint8Array([0, 1, 2, 3]);
  if (options.withExternalLink) {
    files['xl/externalLinks/externalLink1.xml'] = strToU8('<externalLink/>');
  }
  return zipSync(files);
}
