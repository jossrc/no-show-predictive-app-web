import type {
  AttendanceOutcome,
  NewAttendanceOutcome,
  NewOverbookingAuthorization,
  NewSpaceRecoveryOutcome,
  OverbookingAuthorization,
  SpaceRecoveryOutcome,
} from '../../src/modules/OperationalOptimization/Shared/models/OperationalRecords.js';
import type { AttendanceOutcomeRepository } from '../../src/modules/OperationalOptimization/Shared/persistence/AttendanceOutcomeRepository.js';
import type {
  InsertOutcome,
  OperationalRecordListCriteria,
  OperationalRecordPage,
} from '../../src/modules/OperationalOptimization/Shared/persistence/OperationalRecordListCriteria.js';
import type { OperationalRepositories } from '../../src/modules/OperationalOptimization/Shared/persistence/OperationalRepositories.js';
import type { OverbookingAuthorizationRepository } from '../../src/modules/OperationalOptimization/Shared/persistence/OverbookingAuthorizationRepository.js';
import type { SpaceRecoveryOutcomeRepository } from '../../src/modules/OperationalOptimization/Shared/persistence/SpaceRecoveryOutcomeRepository.js';
import type { ReservationOperationalStatus } from '../../src/modules/Reservations/Shared/models/ReservationOperationalStatus.js';
import type { ReservationOperationalStatusReader } from '../../src/modules/Reservations/Shared/persistence/ReservationOperationalStatusReader.js';

interface Slot {
  readonly reservationId: string;
  readonly clinicId: number;
  readonly appointmentAt: Date;
}

function compareSlots(left: Slot, right: Slot): number {
  const byTime = left.appointmentAt.getTime() - right.appointmentAt.getTime();
  if (byTime !== 0) return byTime;
  const a = BigInt(left.reservationId);
  const b = BigInt(right.reservationId);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Misma semántica que buildListClause (período, sede, alcance, keyset ascendente). */
function listSlots<T extends Slot>(
  rows: readonly T[],
  criteria: OperationalRecordListCriteria,
): OperationalRecordPage<T> {
  const filtered = rows
    .filter(
      (row) =>
        row.appointmentAt >= criteria.startInclusive && row.appointmentAt < criteria.endExclusive,
    )
    .filter((row) => criteria.clinicId === null || row.clinicId === criteria.clinicId)
    .filter(
      (row) =>
        criteria.clinicScope.kind === 'ALL_CLINICS' ||
        criteria.clinicScope.clinicIds.includes(row.clinicId),
    )
    .filter((row) => !criteria.after || compareSlots(row, { ...row, ...criteria.after }) > 0)
    .sort(compareSlots);
  return { rows: filtered.slice(0, criteria.limit), hasMore: filtered.length > criteria.limit };
}

/**
 * Registros Sprint 02 en memoria con las reglas de la BD: UNIQUE por reserva, sin UPDATE/DELETE
 * y ganador estable ante «carreras». `inserts` cuenta INSERT efectivos (aserciones de cero
 * escrituras). Las integraciones verifican lo mismo sobre PostgreSQL real.
 */
export class InMemoryOperationalStore
  implements OperationalRepositories, ReservationOperationalStatusReader
{
  readonly authorizationRows: OverbookingAuthorization[] = [];
  readonly attendanceRows: AttendanceOutcome[] = [];
  readonly recoveryRows: SpaceRecoveryOutcome[] = [];
  inserts = 0;
  /** Simula la caída del almacén PostgreSQL de la app en cualquier operación. */
  failWith: Error | null = null;
  private sequence = 1;

  private async guard(): Promise<void> {
    if (this.failWith) throw this.failWith;
  }

  get authorizations(): OverbookingAuthorizationRepository {
    return {
      findByReservation: async (id) => (
        await this.guard(),
        this.authorizationRows.find((row) => row.reservationId === id) ?? null
      ),
      insertIfAbsent: (row) => this.insertAuthorization(row),
      list: async (criteria) => (await this.guard(), listSlots(this.authorizationRows, criteria)),
    };
  }

  get attendance(): AttendanceOutcomeRepository {
    return {
      findByReservation: async (id) => (
        await this.guard(),
        this.attendanceRows.find((row) => row.reservationId === id) ?? null
      ),
      insertIfAbsent: (row) => this.insertAttendance(row),
      list: async (criteria) => (await this.guard(), listSlots(this.attendanceRows, criteria)),
    };
  }

  get recoveries(): SpaceRecoveryOutcomeRepository {
    return {
      findByReservation: async (id) => (
        await this.guard(),
        this.recoveryRows.find((row) => row.reservationId === id) ?? null
      ),
      insertIfAbsent: (row) => this.insertRecovery(row),
      list: async (criteria) => (await this.guard(), listSlots(this.recoveryRows, criteria)),
    };
  }

  async statusesFor(
    reservationIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReservationOperationalStatus>> {
    await this.guard();
    const statuses = new Map<string, ReservationOperationalStatus>();
    for (const id of reservationIds) {
      const authorization = this.authorizationRows.find((row) => row.reservationId === id);
      const attendance = this.attendanceRows.find((row) => row.reservationId === id);
      const recovery = this.recoveryRows.find((row) => row.reservationId === id);
      if (!authorization && !attendance && !recovery) continue;
      statuses.set(id, {
        overbooking: authorization
          ? {
              authorizationId: authorization.authorizationId,
              enabledAt: authorization.enabledAt,
              modelKey: authorization.modelKey,
              predictionRunId: authorization.predictionRunId,
            }
          : null,
        attendanceOutcome: attendance
          ? {
              attendanceStatus: attendance.attendanceStatus,
              recordedAt: attendance.recordedAt,
              predictionRunId: attendance.predictionRunId,
            }
          : null,
        spaceRecoveryOutcome: recovery
          ? {
              authorizationId: recovery.authorizationId,
              spaceRecovered: recovery.spaceRecovered,
              recordedAt: recovery.recordedAt,
            }
          : null,
      });
    }
    return statuses;
  }

  private async insertAuthorization(
    row: NewOverbookingAuthorization,
  ): Promise<InsertOutcome<OverbookingAuthorization>> {
    const existing = this.authorizationRows.find(
      (item) => item.reservationId === row.reservationId,
    );
    if (existing) return { record: existing, created: false };
    const record = { ...row, authorizationId: String(this.sequence++) };
    this.authorizationRows.push(record);
    this.inserts += 1;
    return { record, created: true };
  }

  private async insertAttendance(
    row: NewAttendanceOutcome,
  ): Promise<InsertOutcome<AttendanceOutcome>> {
    const existing = this.attendanceRows.find((item) => item.reservationId === row.reservationId);
    if (existing) return { record: existing, created: false };
    const record = { ...row, attendanceOutcomeId: String(this.sequence++) };
    this.attendanceRows.push(record);
    this.inserts += 1 + row.comparisons.length;
    return { record, created: true };
  }

  private async insertRecovery(
    row: NewSpaceRecoveryOutcome,
  ): Promise<InsertOutcome<SpaceRecoveryOutcome>> {
    const authorization = this.authorizationRows.find(
      (item) =>
        item.authorizationId === row.authorizationId && item.reservationId === row.reservationId,
    );
    if (!authorization) throw new Error('FK: autorización inexistente');
    const existing = this.recoveryRows.find((item) => item.reservationId === row.reservationId);
    if (existing) return { record: existing, created: false };
    const record = { ...row, recoveryOutcomeId: String(this.sequence++) };
    this.recoveryRows.push(record);
    this.inserts += 1;
    return { record, created: true };
  }
}
