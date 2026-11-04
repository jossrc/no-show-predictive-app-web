import type { AttendanceOutcomeRepository } from './AttendanceOutcomeRepository.js';
import type { OverbookingAuthorizationRepository } from './OverbookingAuthorizationRepository.js';
import type { SpaceRecoveryOutcomeRepository } from './SpaceRecoveryOutcomeRepository.js';

/** Repositorios Sprint 02 sobre el almacén PostgreSQL de la app (o dobles en memoria). */
export interface OperationalRepositories {
  readonly authorizations: OverbookingAuthorizationRepository;
  readonly attendance: AttendanceOutcomeRepository;
  readonly recoveries: SpaceRecoveryOutcomeRepository;
}
