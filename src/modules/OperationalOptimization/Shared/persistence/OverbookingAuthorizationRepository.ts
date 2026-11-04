import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  NewOverbookingAuthorization,
  OverbookingAuthorization,
} from '../models/OperationalRecords.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from './OperationalRecordListCriteria.js';

/** HU-06: autorizaciones inmutables (UNIQUE por reserva; sin revocación ni borrado). */
export interface OverbookingAuthorizationRepository {
  findByReservation(reservationId: DecimalId): Promise<OverbookingAuthorization | null>;
  /** INSERT … ON CONFLICT DO NOTHING; ante carrera devuelve el registro ganador. */
  insertIfAbsent(
    authorization: NewOverbookingAuthorization,
  ): Promise<InsertOutcome<OverbookingAuthorization>>;
  list(
    criteria: OperationalRecordListCriteria,
  ): Promise<OperationalRecordPage<OverbookingAuthorization>>;
}
