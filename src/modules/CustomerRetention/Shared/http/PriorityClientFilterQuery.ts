import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../app/http/security/RequirePrincipal.js';
import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { PriorityClientFilters, PriorityClientSort } from '../query/PriorityClientQuery.js';
import type { RetentionStatus } from '../rules/RetentionStatus.js';

/** Querystring común (ya validado por el esquema) del listado y la exportación. */
export interface PriorityClientFilterQuery {
  modelKey: MlModelKey;
  clinicId?: string;
  retentionStatus?: RetentionStatus;
  sort: PriorityClientSort;
  direction: 'asc' | 'desc';
}

/** Mismos filtros para listado y exportación; el alcance de sedes viene del principal. */
export function toPriorityClientFilters(
  query: PriorityClientFilterQuery,
  request: FastifyRequest,
): PriorityClientFilters {
  return {
    modelKey: query.modelKey,
    clinicId: query.clinicId === undefined ? null : Number(query.clinicId),
    retentionStatus: query.retentionStatus ?? null,
    sort: query.sort,
    direction: query.direction,
    clinicScope: requirePrincipal(request).clinicScope,
  };
}
