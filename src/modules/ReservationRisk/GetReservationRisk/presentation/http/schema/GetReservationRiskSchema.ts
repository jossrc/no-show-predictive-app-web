import type { FastifySchema } from 'fastify';
import { ErrorResponseSchema } from '../../../../../../app/http/errors/ErrorResponseSchema.js';
import { ReservationIdParamsSchema } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import { RiskAssessmentBodySchema } from '../../../../Shared/http/RiskHttpSchemas.js';

export const GetReservationRiskSchema = {
  tags: ['Reservation Risk'],
  summary: 'Consultar estimaciones guardadas',
  description:
    'Lectura de resultados persistidos: nunca llama a Python ni crea predicciones. status puede ser AVAILABLE_EXPLORATORY, NOT_SCORED o NOT_SCORABLE; este último indica evidencia temporal insuficiente y se acompaña de reasons. Las probabilidades no se redondean para persistencia; percentageNoShow = probabilityNoShow * 100. La etiqueta objetivo es NO_SHOW_CANDIDATE; validationStatus=EXPLORATORY_NOT_VALIDATED, calibrationStatus=not_operationally_validated y operationalUseAllowed=false. riskLevel=null y riskPolicyStatus=pending_validation; comparación descriptiva sin ensemble ni selección automática de ganador.',
  security: [{ InternalApiKey: [] }],
  params: ReservationIdParamsSchema,
  response: {
    200: {
      description:
        'Estimaciones guardadas o estado NOT_SCORED / NOT_SCORABLE con sus motivos; no ejecuta inferencia.',
      type: 'object',
      additionalProperties: false,
      required: ['data', 'requestId'],
      properties: { data: RiskAssessmentBodySchema, requestId: { type: 'string' } },
    },
    400: {
      ...ErrorResponseSchema,
      description: 'Solicitud inválida: REQUEST_VALIDATION_ERROR en parámetros, query o cuerpo.',
    },
    401: {
      ...ErrorResponseSchema,
      description:
        'Credencial x-api-key ausente o inválida; se comprueba antes de validar la solicitud.',
    },
    404: {
      ...ErrorResponseSchema,
      description: 'RESERVATION_NOT_FOUND: reserva inexistente o inaccesible para el consumidor.',
    },
    503: {
      ...ErrorResponseSchema,
      description: 'Servicio, fuente de datos o persistencia no disponible.',
    },
  },
} as const satisfies FastifySchema;
