import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import type { PredictionRunReader } from '../../../ReservationRisk/Shared/persistence/PredictionRunReader.js';
import type { OverbookingEligibilityResolver } from '../../Shared/access/OverbookingEligibilityResolver.js';
import { OverbookingAlreadyEnabledConflictException } from '../../Shared/errors/OverbookingAlreadyEnabledConflictException.js';
import { OverbookingNotEligibleException } from '../../Shared/errors/OverbookingNotEligibleException.js';
import { PredictionReservationMismatchException } from '../../Shared/errors/PredictionReservationMismatchException.js';
import type { OverbookingAuthorization } from '../../Shared/models/OperationalRecords.js';
import type { OverbookingAuthorizationRepository } from '../../Shared/persistence/OverbookingAuthorizationRepository.js';
import {
  ineligibility,
  OVERBOOKING_ELIGIBILITY_RULE_VERSION,
} from '../../Shared/rules/OverbookingEligibility.js';
import type { EnableOverbookingInput } from './input/EnableOverbookingInput.js';
import type { EnableOverbookingResult } from './result/EnableOverbookingResult.js';

export interface EnableOverbookingDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly eligibility: OverbookingEligibilityResolver;
  readonly runs: PredictionRunReader;
  readonly authorizations: OverbookingAuthorizationRepository;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

function sameRequest(existing: OverbookingAuthorization, input: EnableOverbookingInput): boolean {
  return existing.modelKey === input.modelKey && existing.predictionRunId === input.predictionRunId;
}

/**
 * HU-06 (acción explícita y confirmada por el supervisor en el FE): MARCA un horario de riesgo
 * experimental Alto como «Habilitado para sobreasignación». Solo inserta en ml.app_*: no crea
 * citas, no libera agenda, no escribe en FLOWww ni llama a Python. Idempotente por reserva.
 */
export class EnableOverbooking {
  constructor(private readonly deps: EnableOverbookingDependencies) {}

  async execute(input: EnableOverbookingInput): Promise<EnableOverbookingResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );

    const existing = await this.deps.authorizations.findByReservation(reservation.reservationId);
    if (existing) return this.replayOrConflict(existing, input);

    const { eligibility } = await this.deps.eligibility.resolve(reservation, false);
    const candidate = eligibility.candidates.find((item) => item.modelKey === input.modelKey);
    const evidence = allowedSnapshotEvidence(this.deps.mode);
    const runResults = await this.deps.runs.findRunResults(
      reservation.reservationId,
      input.predictionRunId,
      evidence,
    );
    const score = runResults.find((result) => result.modelKey === input.modelKey);
    if (!score) throw new PredictionReservationMismatchException();

    // Solo la ÚLTIMA predicción del modelo (la que muestra la UI) justifica la marca.
    if (!candidate || candidate.predictionRunId !== input.predictionRunId) {
      throw new OverbookingNotEligibleException([ineligibility('PREDICTION_NOT_LATEST')]);
    }
    const reasons = [...eligibility.reasons, ...candidate.reasons];
    if (reasons.length > 0) throw new OverbookingNotEligibleException(reasons);

    const risk = score.experimentalRisk;
    if (!risk || risk.level !== 'HIGH') {
      throw new OverbookingNotEligibleException([ineligibility('PREDICTION_NOT_HIGH')]);
    }

    const outcome = await this.deps.authorizations.insertIfAbsent({
      reservationId: reservation.reservationId,
      clinicId: reservation.clinicId,
      appointmentAt: reservation.appointmentAt,
      status: 'ENABLED',
      enabledAt: this.deps.clock.now(),
      requestId: input.requestId,
      actorKind: 'INTERNAL_SERVICE',
      actorUserId: null,
      predictionRunId: score.predictionRunId,
      predictionResultId: score.resultId,
      modelKey: score.modelKey,
      modelVersion: score.modelVersion,
      researchPolicyHash: risk.policyHash,
      researchPolicyVersion: risk.policyVersion,
      riskBandAtAuthorization: 'HIGH',
      probabilityNoShowAtAuthorization: score.probabilityNoShow,
      scoredAt: score.scoredAt,
      eligibilityRuleVersion: OVERBOOKING_ELIGIBILITY_RULE_VERSION,
    });
    // Carrera: otra petición creó la marca entre la lectura y el INSERT.
    if (!outcome.created) return this.replayOrConflict(outcome.record, input);
    return { authorization: outcome.record, replayed: false };
  }

  private replayOrConflict(
    existing: OverbookingAuthorization,
    input: EnableOverbookingInput,
  ): EnableOverbookingResult {
    if (!sameRequest(existing, input)) {
      throw new OverbookingAlreadyEnabledConflictException({
        authorizationId: existing.authorizationId,
        modelKey: existing.modelKey,
        predictionRunId: existing.predictionRunId,
      });
    }
    return { authorization: existing, replayed: true };
  }
}
