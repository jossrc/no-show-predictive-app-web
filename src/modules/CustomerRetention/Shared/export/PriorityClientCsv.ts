import { toLimaParts } from '../../../../shared/time/LimaTime.js';
import type { PriorityClient } from '../query/PriorityClientQuery.js';
import { RETENTION_STATUS_LABELS } from '../rules/RetentionStatus.js';

export const CSV_DELIMITERS = { comma: ',', semicolon: ';' } as const;
export type CsvDelimiter = keyof typeof CSV_DELIMITERS;

/** BOM UTF-8: Excel reconoce la codificación (tildes y ñ) al abrir el archivo. */
export const UTF8_BOM = '﻿';
const LINE_BREAK = '\r\n';

/** Prefijos que una hoja de cálculo interpretaría como fórmula (CSV/Formula Injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Celda segura: neutraliza cualquier contenido que empiece como fórmula anteponiendo `'` y
 * siempre se entrecomilla (comillas internas duplicadas). Los identificadores viajan como texto
 * exacto (sin notación científica ni pérdida de dígitos en el archivo).
 */
export function toSafeCsvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const neutralized = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function limaDateTime(instant: Date): string {
  const parts = toLimaParts(instant);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export const PRIORITY_CLIENT_CSV_HEADERS = [
  'ID cliente',
  'ID reserva',
  'Fecha y hora de cita (America/Lima)',
  'Fecha y hora de cita (UTC)',
  'ID sede',
  'Modelo predictivo',
  'Versión del modelo',
  'Probabilidad estimada de inasistencia',
  'Porcentaje estimado de inasistencia',
  'Banda relativa de riesgo (experimental)',
  'Estado de gestión de retención',
  'Fecha y hora de contacto (America/Lima)',
  'ID de ejecución de predicción',
  'Fecha de estimación (UTC)',
  'Política experimental',
  'Origen de la reserva',
] as const;

export function priorityClientCsvRow(item: PriorityClient): Array<string | number | null> {
  const { reservation, score, experimentalRisk, contact } = item;
  return [
    reservation.clientId,
    reservation.reservationId,
    limaDateTime(reservation.appointmentAt),
    reservation.appointmentAt.toISOString(),
    reservation.clinicId,
    score.modelKey,
    score.modelVersion,
    score.probabilityNoShow,
    (score.probabilityNoShow * 100).toFixed(2),
    experimentalRisk.label,
    RETENTION_STATUS_LABELS[item.retentionStatus],
    contact ? limaDateTime(contact.contactedAt) : null,
    score.predictionRunId,
    score.scoredAt.toISOString(),
    `${experimentalRisk.policyId} ${experimentalRisk.policyVersion}`,
    reservation.origin === 'IMPORT' ? 'Importación de archivo' : 'Sistema de agendamiento',
  ];
}

export function toCsvLine(
  cells: ReadonlyArray<string | number | null>,
  delimiter: CsvDelimiter,
): string {
  return cells.map(toSafeCsvCell).join(CSV_DELIMITERS[delimiter]) + LINE_BREAK;
}

/** Nombre descriptivo y sin caracteres conflictivos: modelo + instante de generación (Lima). */
export function priorityClientCsvFilename(modelKey: string, generatedAt: Date): string {
  const parts = toLimaParts(generatedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(parts.hour)}${pad(parts.minute)}`;
  return `clientes-prioritarios-retencion_${modelKey}_${stamp}.csv`;
}
