/**
 * Calendario local de America/Lima independiente de la zona horaria del proceso.
 * Usa la base IANA de Intl (ICU completo en Node 24); no aplica offsets fijos.
 * Los instantes se conservan como Date (UTC); solo los componentes de calendario son locales.
 */
export const LIMA_TIME_ZONE = 'America/Lima';

export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface LocalDateTimeParts extends LocalDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** ISO 8601: 1 = lunes … 7 = domingo. */
  readonly isoWeekday: number;
}

const ISO_WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const limaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LIMA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const ISO_LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function assertValidInstant(instant: Date): void {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError('Se esperaba un instante válido');
  }
}

export function toLimaParts(instant: Date): LocalDateTimeParts {
  assertValidInstant(instant);

  const values: Record<string, string> = {};
  for (const part of limaFormatter.formatToParts(instant)) {
    values[part.type] = part.value;
  }

  const isoWeekday = ISO_WEEKDAYS[values.weekday ?? ''];
  if (isoWeekday === undefined) {
    throw new Error('No se pudo determinar el día de la semana en America/Lima');
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    isoWeekday,
  };
}

function limaOffsetMs(instant: Date): number {
  const parts = toLimaParts(instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/** Convierte una fecha/hora de pared de Lima al instante UTC correspondiente. */
export function limaLocalToInstant(date: LocalDate, hour = 0, minute = 0, second = 0): Date {
  const wallClockAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second);
  const firstOffset = limaOffsetMs(new Date(wallClockAsUtc));
  const candidate = wallClockAsUtc - firstOffset;
  const secondOffset = limaOffsetMs(new Date(candidate));

  return new Date(secondOffset === firstOffset ? candidate : wallClockAsUtc - secondOffset);
}

/** Valida estrictamente `YYYY-MM-DD` y que la fecha exista en el calendario gregoriano. */
export function parseLocalDate(value: string): LocalDate | null {
  const match = ISO_LOCAL_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Días de calendario entre dos fechas locales (to - from). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      MS_PER_DAY,
  );
}

/** Intervalo inclusivo por día en Lima normalizado a `[startInclusive, endExclusive)` UTC. */
export function limaDayRangeToInstants(
  from: LocalDate,
  to: LocalDate,
): { startInclusive: Date; endExclusive: Date } {
  return {
    startInclusive: limaLocalToInstant(from),
    endExclusive: limaLocalToInstant(addDays(to, 1)),
  };
}

export function limaCalendarDate(instant: Date): LocalDate {
  const parts = toLimaParts(instant);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function formatLocalDate(date: LocalDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

/** Años cumplidos en `on` para una persona nacida en `birth` (equivalente a AGE() de PostgreSQL). */
export function completedYears(birth: LocalDate, on: LocalDate): number {
  let years = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) {
    years -= 1;
  }
  return years;
}

export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return (
    Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day)
  );
}
