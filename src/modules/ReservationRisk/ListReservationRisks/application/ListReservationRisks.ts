import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import { LIMA_TIME_ZONE } from '../../../../shared/time/LimaTime.js';
import { InvalidReservationQueryException } from '../../../Reservations/Shared/errors/InvalidReservationQueryException.js';
import {
  decodeReservationCursor,
  encodeReservationCursor,
} from '../../../Reservations/Shared/pagination/ReservationCursor.js';
import type {
  ProbabilityRange,
  ReservationListRow,
  ReservationRepository,
} from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { RiskPolicyUnavailableException } from '../../Shared/errors/RiskPolicyUnavailableException.js';
import type { BookingEvidenceSource } from '../../Shared/persistence/BookingEvidenceSource.js';
import type { RiskLevelPolicy } from '../../Shared/policy/RiskLevelPolicy.js';
import { preAssessScorability } from '../../Shared/validation/PreAssessScorability.js';
import type { ListReservationRisksInput } from './input/ListReservationRisksInput.js';
import { resolveListPeriod } from './ResolveListPeriod.js';
import type {
  ListReservationRisksItem,
  ListReservationRisksResult,
} from './result/ListReservationRisksResult.js';

export interface ListReservationRisksDependencies {
  readonly reservations: ReservationRepository;
  readonly policy: RiskLevelPolicy;
  readonly evidenceSource: Pick<BookingEvidenceSource, 'servicesTemporalEvidence'>;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

/**
 * HU-01/HU-03: citas programadas del período con sus scores persistidos (una consulta paginada,
 * sin llamadas ML por fila). Niveles LOW/MEDIUM/HIGH solo con política aprobada.
 */
export class ListReservationRisks {
  constructor(private readonly deps: ListReservationRisksDependencies) {}

  async execute(input: ListReservationRisksInput): Promise<ListReservationRisksResult> {
    const period = resolveListPeriod(input.from, input.to);
    const policyAvailable = this.deps.policy.isAvailableFor(input.modelKey);
    const usesRiskLevel = input.sort === 'riskLevel' || input.riskLevel !== null;

    if (usesRiskLevel && !policyAvailable) throw new RiskPolicyUnavailableException();

    const probabilityRange = this.resolveBand(input);
    if (input.clinicId !== null && !(await this.deps.reservations.clinicExists(input.clinicId))) {
      throw new InvalidReservationQueryException('UNKNOWN_CLINIC', 'clinicId', 'La sede no existe');
    }

    const sortField = input.sort === 'appointmentAt' ? 'appointmentAt' : 'probabilityNoShow';
    const signature = [
      input.status,
      input.sort,
      input.direction,
      input.modelKey,
      input.from,
      input.to,
      input.clinicId ?? '-',
      input.riskLevel ?? '-',
    ].join('|');
    const after = input.cursor ? decodeReservationCursor(input.cursor, signature) : null;

    const page = await this.deps.reservations.list({
      startInclusive: period.startInclusive,
      endExclusive: period.endExclusive,
      status: input.status,
      clinicId: input.clinicId,
      clinicScope: input.clinicScope,
      sortField,
      sortDirection: input.direction,
      modelKey: input.modelKey,
      probabilityRange,
      snapshotEvidence: allowedSnapshotEvidence(this.deps.mode),
      after,
      limit: input.limit,
    });

    const last = page.rows.at(-1);
    const nextCursor =
      page.hasMore && last
        ? encodeReservationCursor(
            {
              probability: sortField === 'probabilityNoShow' ? last.sortProbability : undefined,
              appointmentAt: last.reservation.appointmentAt,
              reservationId: last.reservation.reservationId,
            },
            signature,
          )
        : null;

    return {
      items: page.rows.map((row) => this.toItem(row)),
      nextCursor,
      limit: input.limit,
      period: { from: input.from, to: input.to, timeZone: LIMA_TIME_ZONE, ...period },
      sort: {
        field: input.sort,
        direction: input.direction,
        modelKey: input.modelKey,
        semantics:
          input.sort === 'appointmentAt'
            ? 'CHRONOLOGICAL'
            : input.sort === 'riskLevel'
              ? 'APPROVED_RISK_POLICY'
              : 'EXPLORATORY_SCORE_ORDER',
      },
      riskPolicyStatus: this.deps.policy.status,
      classificationUnavailable: !policyAvailable,
      sourceStatus: this.deps.mode,
      predictiveStoreAvailable: page.predictiveStoreAvailable,
    };
  }

  private resolveBand(input: ListReservationRisksInput): ProbabilityRange | null {
    if (input.riskLevel === null) return null;
    const band = this.deps.policy.bandFor(input.riskLevel, input.modelKey);
    if (!band) throw new RiskPolicyUnavailableException();
    return band;
  }

  private toItem(row: ReservationListRow): ListReservationRisksItem {
    const { reservation } = row;
    const stale =
      reservation.status === 'SCHEDULED' &&
      reservation.appointmentAt.getTime() <= this.deps.clock.now().getTime();
    const assessment = preAssessScorability(
      reservation,
      { hasScores: row.scores.length > 0, hasUsableSnapshot: row.hasUsableSnapshot },
      {
        mode: this.deps.mode,
        servicesTemporalEvidence: this.deps.evidenceSource.servicesTemporalEvidence,
      },
    );

    return {
      reservation,
      sourceFreshness: stale ? 'STALE_CLASSIFICATION' : 'CURRENT',
      predictionAvailability: assessment.availability,
      notScorableReasons: assessment.reasons,
      scores: row.scores.map((score) => ({
        ...score,
        policyRiskLevel: this.deps.policy.isAvailableFor(score.modelKey)
          ? this.deps.policy.classify(score)
          : null,
      })),
    };
  }
}
