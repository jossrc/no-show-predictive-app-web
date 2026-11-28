import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { Reservation } from '../models/Reservation.js';
import type {
  ReservationSource,
  ReservationSourceCriteria,
  ReservationSourcePage,
} from './ReservationSource.js';

/** Identificadores que ya existen en la fuente principal (lectura por lote, sin N+1). */
export interface ReservationIdLookup {
  existingReservationIds(ids: readonly DecimalId[]): Promise<ReadonlySet<DecimalId>>;
}

function compareChronological(left: Reservation, right: Reservation): number {
  const byTime = left.appointmentAt.getTime() - right.appointmentAt.getTime();
  if (byTime !== 0) return byTime;
  const a = BigInt(left.reservationId);
  const b = BigInt(right.reservationId);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Une la fuente principal (sistema de agendamiento, solo lectura) con una fuente adicional de
 * reservas incorporadas (ml.app_imported_reservations) sin construir un listado paralelo: ambas
 * aplican los mismos filtros y el mismo keyset (appointmentAt, reservationId), y la página se
 * obtiene por mezcla top-k. La fuente principal prevalece: una reserva incorporada cuyo ID llegue
 * a existir en la fuente principal queda oculta (nunca se duplica ni se mezcla su procedencia).
 */
export class CompositeReservationSource implements ReservationSource {
  constructor(
    private readonly primary: ReservationSource,
    private readonly secondary: ReservationSource,
    private readonly primaryIds: ReservationIdLookup,
  ) {}

  async list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage> {
    const [primary, secondary] = await Promise.all([
      this.primary.list(criteria),
      this.visibleSecondary(criteria),
    ]);
    const direction = criteria.direction === 'desc' ? -1 : 1;
    const merged = [...primary.rows, ...secondary.rows].sort(
      (left, right) => direction * compareChronological(left, right),
    );
    return {
      rows: merged.slice(0, criteria.limit),
      hasMore: merged.length > criteria.limit || primary.hasMore || secondary.hasMore,
    };
  }

  async findById(reservationId: DecimalId): Promise<Reservation | null> {
    const primary = await this.primary.findById(reservationId);
    if (primary) return primary;
    const secondary = await this.secondary.findById(reservationId);
    if (!secondary) return null;
    const shadowed = await this.primaryIds.existingReservationIds([reservationId]);
    return shadowed.has(reservationId) ? null : secondary;
  }

  /** El catálogo de sedes pertenece a la fuente principal (las importadas se validan contra él). */
  async clinicExists(clinicId: number): Promise<boolean> {
    return this.primary.clinicExists(clinicId);
  }

  /** Página de la fuente adicional sin filas ocultas por la principal (rellena si hace falta). */
  private async visibleSecondary(
    criteria: ReservationSourceCriteria,
  ): Promise<ReservationSourcePage> {
    const visible: Reservation[] = [];
    let after = criteria.after;
    for (;;) {
      const page = await this.secondary.list({ ...criteria, after });
      const shadowed =
        page.rows.length === 0
          ? new Set<DecimalId>()
          : await this.primaryIds.existingReservationIds(page.rows.map((row) => row.reservationId));
      visible.push(...page.rows.filter((row) => !shadowed.has(row.reservationId)));
      const last = page.rows.at(-1);
      if (visible.length > criteria.limit || !page.hasMore || !last) {
        return {
          rows: visible.slice(0, criteria.limit),
          hasMore: visible.length > criteria.limit || page.hasMore,
        };
      }
      if (visible.length === criteria.limit) {
        return { rows: visible, hasMore: true };
      }
      after = { appointmentAt: last.appointmentAt, reservationId: last.reservationId };
    }
  }
}
