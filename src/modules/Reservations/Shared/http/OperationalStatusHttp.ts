import type { ReservationOperationalStatus } from '../models/ReservationOperationalStatus.js';

/**
 * Resumen de gestión Sprint 02 (HU-06/07/08) añadido de forma ADITIVA al detalle y al listado de
 * reservas. Cada objeto es null solo si el almacén de la app no pudo consultarse
 * (predictiveStoreAvailable=false); en otro caso expone un estado explícito.
 */
export const OVERBOOKING_STATUS_LABELS = {
  ENABLED: 'Habilitado para sobreasignación',
  NOT_ENABLED: 'No habilitado',
} as const;

export interface OverbookingSummaryBody {
  enabled: boolean;
  status: 'ENABLED' | 'NOT_ENABLED';
  statusLabel: string;
  authorizationId: string | null;
  enabledAt: string | null;
  modelKey: string | null;
  predictionRunId: string | null;
}

export interface AttendanceSummaryBody {
  recorded: boolean;
  attendanceStatus: 'ATTENDED' | 'NO_SHOW' | null;
  recordedAt: string | null;
}

export interface SpaceRecoverySummaryBody {
  recorded: boolean;
  spaceRecovered: boolean | null;
  recordedAt: string | null;
}

export interface OperationalStatusBody {
  overbooking: OverbookingSummaryBody | null;
  attendanceOutcome: AttendanceSummaryBody | null;
  spaceRecoveryOutcome: SpaceRecoverySummaryBody | null;
}

export function toOperationalStatusBody(
  status: ReservationOperationalStatus | null,
): OperationalStatusBody {
  if (!status) return { overbooking: null, attendanceOutcome: null, spaceRecoveryOutcome: null };
  const { overbooking, attendanceOutcome, spaceRecoveryOutcome } = status;
  return {
    overbooking: {
      enabled: overbooking !== null,
      status: overbooking ? 'ENABLED' : 'NOT_ENABLED',
      statusLabel: OVERBOOKING_STATUS_LABELS[overbooking ? 'ENABLED' : 'NOT_ENABLED'],
      authorizationId: overbooking?.authorizationId ?? null,
      enabledAt: overbooking?.enabledAt.toISOString() ?? null,
      modelKey: overbooking?.modelKey ?? null,
      predictionRunId: overbooking?.predictionRunId ?? null,
    },
    attendanceOutcome: {
      recorded: attendanceOutcome !== null,
      attendanceStatus: attendanceOutcome?.attendanceStatus ?? null,
      recordedAt: attendanceOutcome?.recordedAt.toISOString() ?? null,
    },
    spaceRecoveryOutcome: {
      recorded: spaceRecoveryOutcome !== null,
      spaceRecovered: spaceRecoveryOutcome?.spaceRecovered ?? null,
      recordedAt: spaceRecoveryOutcome?.recordedAt.toISOString() ?? null,
    },
  };
}

const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

export const OverbookingSummarySchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  description:
    'HU-06: marca de gestión propia (no cambia reservationStatus ni FLOWww). null solo si el almacén de la app no está disponible.',
  required: [
    'enabled',
    'status',
    'statusLabel',
    'authorizationId',
    'enabledAt',
    'modelKey',
    'predictionRunId',
  ],
  properties: {
    enabled: { type: 'boolean' },
    status: { type: 'string', enum: ['ENABLED', 'NOT_ENABLED'] },
    statusLabel: { type: 'string', enum: Object.values(OVERBOOKING_STATUS_LABELS) },
    authorizationId: { type: ['string', 'null'] },
    enabledAt: nullableDateTime,
    modelKey: { type: ['string', 'null'] },
    predictionRunId: { type: ['string', 'null'] },
  },
} as const;

export const AttendanceSummarySchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  description:
    'HU-07: asistencia observada registrada explícitamente (recorded=false ⇒ attendanceStatus=null). null solo si el almacén no está disponible.',
  required: ['recorded', 'attendanceStatus', 'recordedAt'],
  properties: {
    recorded: { type: 'boolean' },
    attendanceStatus: { type: ['string', 'null'], enum: ['ATTENDED', 'NO_SHOW', null] },
    recordedAt: nullableDateTime,
  },
} as const;

export const SpaceRecoverySummarySchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  description:
    'HU-08: spaceRecovered=false significa «gestionado sin recuperar»; null significa «sin registro». El objeto es null solo si el almacén no está disponible.',
  required: ['recorded', 'spaceRecovered', 'recordedAt'],
  properties: {
    recorded: { type: 'boolean' },
    spaceRecovered: { type: ['boolean', 'null'] },
    recordedAt: nullableDateTime,
  },
} as const;

export const OperationalStatusProperties = {
  overbooking: OverbookingSummarySchema,
  attendanceOutcome: AttendanceSummarySchema,
  spaceRecoveryOutcome: SpaceRecoverySummarySchema,
} as const;

export const OPERATIONAL_STATUS_REQUIRED = [
  'overbooking',
  'attendanceOutcome',
  'spaceRecoveryOutcome',
] as const;
