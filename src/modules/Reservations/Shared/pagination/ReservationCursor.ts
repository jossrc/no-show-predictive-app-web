import { InvalidReservationQueryException } from '../errors/InvalidReservationQueryException.js';

/** Posición keyset: valor de orden + desempate estable (appointmentAt, reservationId). */
export interface ReservationCursorPosition {
  readonly probability: number | null | undefined;
  readonly appointmentAt: Date;
  readonly reservationId: string;
}

interface EncodedCursor {
  v: 1;
  s: string;
  p?: number | null;
  a: string;
  r: string;
}

const MAX_CURSOR_LENGTH = 512;

/**
 * El cursor es opaco y queda ligado a la «firma» de la consulta (orden, modelo, filtros):
 * reutilizarlo con otro orden se rechaza en lugar de devolver páginas incoherentes.
 */
export function encodeReservationCursor(
  position: ReservationCursorPosition,
  signature: string,
): string {
  const payload: EncodedCursor = {
    v: 1,
    s: signature,
    a: position.appointmentAt.toISOString(),
    r: position.reservationId,
    ...(position.probability !== undefined ? { p: position.probability } : {}),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function invalidCursor(): InvalidReservationQueryException {
  return new InvalidReservationQueryException(
    'INVALID_CURSOR',
    'cursor',
    'El cursor de paginación no es válido para esta consulta',
  );
}

export function decodeReservationCursor(
  raw: string,
  expectedSignature: string,
): ReservationCursorPosition {
  if (raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalidCursor();

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  if (typeof decoded !== 'object' || decoded === null) throw invalidCursor();
  const cursor = decoded as Partial<EncodedCursor>;
  const appointmentAt = typeof cursor.a === 'string' ? new Date(cursor.a) : null;

  const probabilityValid =
    cursor.p === undefined ||
    cursor.p === null ||
    (typeof cursor.p === 'number' && Number.isFinite(cursor.p) && cursor.p >= 0 && cursor.p <= 1);

  if (
    cursor.v !== 1 ||
    cursor.s !== expectedSignature ||
    !appointmentAt ||
    Number.isNaN(appointmentAt.getTime()) ||
    typeof cursor.r !== 'string' ||
    !/^[1-9][0-9]{0,17}$/.test(cursor.r) ||
    !probabilityValid
  ) {
    throw invalidCursor();
  }

  return { probability: cursor.p, appointmentAt, reservationId: cursor.r };
}
