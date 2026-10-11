import { DECIMAL_ID_PATTERN } from '../../../../shared/identifiers/DecimalId.js';

/** BIGINT como cadena decimal: sin parseInt parcial ("123abc") ni pérdida de precisión. */
export interface ReservationIdParams {
  reservationId: string;
}

export const ReservationIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reservationId'],
  properties: {
    reservationId: { type: 'string', pattern: DECIMAL_ID_PATTERN },
  },
} as const;
