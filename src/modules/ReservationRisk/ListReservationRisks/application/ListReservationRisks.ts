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
import type { ReservationScoreReader } from '../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import { RiskPolicyUnavailableException } from '../../Shared/errors/RiskPolicyUnavailableException.js';
import type { BookingEvidenceSource } from '../../Shared/persistence/BookingEvidenceSource.js';
import type { RiskLevelPolicy } from '../../Shared/policy/RiskLevelPolicy.js';
import { preAssessScorability } from '../../Shared/validation/PreAssessScorability.js';
import type { ListReservationRisksInput } from './input/ListReservationRisksInput.js';
import { resolveListPeriod } from './ResolveListPeriod.js';
import type {
  ListExperimentalRiskPolicy,
  ListReservationRisksItem,
  ListReservationRisksResult,
} from './result/ListReservationRisksResult.js';

export interface ListReservationRisksDependencies {
  readonly reservations: ReservationRepository;
  readonly policy: RiskLevelPolicy;
  readonly evidenceSource: Pick<BookingEvidenceSource, 'snapshotEvidenceSource'>;
  /** Política research vigente según el almacén local (sin llamar a Python). */
  readonly scores: Pick<ReservationScoreReader, 'currentExperimentalPolicy'>;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

/**
 * HU-01/HU-03: citas programadas del período con sus scores persistidos (sin llamadas ML por
 * fila). Dos clasificaciones separadas: `riskLevel` operativo solo con política APROBADA (hoy
 * 409 si se filtra/ordena) y banda EXPERIMENTAL research v2 por modelo, filtrable/ordenable
 * bajo una sola política vigente (firmada en el cursor para no mezclar políticas).
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

    const evidence = allowedSnapshotEvidence(this.deps.mode);
    const currentPolicy = await this.deps.scores.currentExperimentalPolicy(
      input.modelKey,
      evidence,
    );
    const experimentalPolicy: ListExperimentalRiskPolicy | null = currentPolicy
      ? { ...currentPolicy, modelKey: input.modelKey }
      : null;

    const sortField =
      input.sort === 'appointmentAt'
        ? 'appointmentAt'
        : input.sort === 'experimentalRisk'
          ? 'experimentalRisk'
          : 'probabilityNoShow';
    const signature = [
      input.status,
      input.sort,
      input.direction,
      input.modelKey,
      input.from,
      input.to,
      input.clinicId ?? '-',
      input.riskLevel ?? '-',
      input.experimentalRiskLevel ?? '-',
      experimentalPolicy?.policyHash ?? '-',
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
      experimentalPolicyHash: experimentalPolicy?.policyHash ?? null,
      experimentalRiskLevel: input.experimentalRiskLevel,
      snapshotEvidence: evidence,
      after,
      limit: input.limit,
    });

    const last = page.rows.at(-1);
    const nextCursor =
      page.hasMore && last
        ? encodeReservationCursor(
            {
              probability: sortField === 'appointmentAt' ? undefined : last.sortProbability,
              appointmentAt: last.reservation.appointmentAt,
              reservationId: last.reservation.reservationId,
            },
            signature,
          )
        : null;

    const items = page.rows.map((row) => this.toItem(row, input.modelKey, experimentalPolicy));
    const operationalUnavailable = !policyAvailable;
    const experimentalUnavailable = experimentalPolicy === null;

    return {
      items,
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
              : input.sort === 'experimentalRisk'
                ? 'EXPERIMENTAL_RESEARCH_BAND_ORDER'
                : 'EXPLORATORY_SCORE_ORDER',
      },
      riskPolicyStatus: this.deps.policy.status,
      classificationUnavailable: operationalUnavailable && experimentalUnavailable,
      operationalClassificationUnavailable: operationalUnavailable,
      experimentalClassificationUnavailable: experimentalUnavailable,
      experimentalRiskPolicy: experimentalPolicy,
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

  private toItem(
    row: ReservationListRow,
    modelKey: ListReservationRisksInput['modelKey'],
    experimentalPolicy: ListExperimentalRiskPolicy | null,
  ): ListReservationRisksItem {
    const { reservation } = row;
    const experimentalRisk =
      row.scores.find((score) => score.modelKey === modelKey)?.experimentalRisk ?? null;
    const stale =
      reservation.status === 'SCHEDULED' &&
      reservation.appointmentAt.getTime() <= this.deps.clock.now().getTime();
    const assessment = preAssessScorability(
      reservation,
      { hasScores: row.scores.length > 0, hasUsableSnapshot: row.hasUsableSnapshot },
      {
        mode: this.deps.mode,
        snapshotEvidenceSource: this.deps.evidenceSource.snapshotEvidenceSource,
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
      experimentalRisk,
      experimentalPolicyCurrent:
        experimentalRisk !== null && experimentalRisk.policyHash === experimentalPolicy?.policyHash,
    };
  }
}
