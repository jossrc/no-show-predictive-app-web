import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import type { PredictionRunReader } from '../../../ReservationRisk/Shared/persistence/PredictionRunReader.js';
import { RetentionClientMismatchException } from '../../Shared/errors/RetentionClientMismatchException.js';
import { RetentionContactConflictException } from '../../Shared/errors/RetentionContactConflictException.js';
import { RetentionNotEligibleException } from '../../Shared/errors/RetentionNotEligibleException.js';
import { RetentionPredictionMismatchException } from '../../Shared/errors/RetentionPredictionMismatchException.js';
import type { RetentionContact } from '../../Shared/models/RetentionContact.js';
import type { RetentionContactRepository } from '../../Shared/persistence/RetentionContactRepository.js';
import {
  evaluateRetentionEligibility,
  RETENTION_ELIGIBILITY_RULE_VERSION,
  retentionIneligibility,
} from '../../Shared/rules/RetentionEligibility.js';
import { retentionWindow } from '../../Shared/rules/RetentionWindow.js';
import type { RecordRetentionContactInput } from './input/RecordRetentionContactInput.js';
import type { RecordRetentionContactResult } from './result/RecordRetentionContactResult.js';

export interface RecordRetentionContactDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly scores: Pick<ReservationScoreReader, 'latestScores' | 'currentExperimentalPolicy'>;
  readonly runs: PredictionRunReader;
  readonly contacts: RetentionContactRepository;
  readonly mode: DataSourceMode;
  readonly clock: Clock;
}

function sameRequest(existing: RetentionContact, input: RecordRetentionContactInput): boolean {
  return existing.modelKey === input.modelKey && existing.predictionRunId === input.predictionRunId;
}

/**
 * Registra que se REALIZÓ una acción de contacto/campaña de retención para una reserva
 * prioritaria. No envía mensajes ni integra canales. Unidad de gestión: la reserva (UNIQUE): un
 * reintento idéntico devuelve el registro original sin sobrescribir su fecha.
 */
export class RecordRetentionContact {
  constructor(private readonly deps: RecordRetentionContactDependencies) {}

  async execute(input: RecordRetentionContactInput): Promise<RecordRetentionContactResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    if (reservation.clientId !== input.clientId) throw new RetentionClientMismatchException();

    const existing = await this.deps.contacts.findByReservation(reservation.reservationId);
    if (existing) return this.replayOrConflict(existing, input);

    const evidence = allowedSnapshotEvidence(this.deps.mode);
    const [latest, policy, runResults] = await Promise.all([
      this.deps.scores.latestScores([reservation.reservationId], evidence),
      this.deps.scores.currentExperimentalPolicy(input.modelKey, evidence),
      this.deps.runs.findRunResults(reservation.reservationId, input.predictionRunId, evidence),
    ]);
    const score = runResults.find((result) => result.modelKey === input.modelKey);
    if (!score) throw new RetentionPredictionMismatchException();

    const now = this.deps.clock.now();
    const reasons = evaluateRetentionEligibility({
      reservation,
      window: retentionWindow(now),
      latestScore:
        latest.get(reservation.reservationId)?.find((item) => item.modelKey === input.modelKey) ??
        null,
      currentPolicyHash: policy?.policyHash ?? null,
      predictionRunId: input.predictionRunId,
    });
    if (reasons.length > 0) throw new RetentionNotEligibleException(reasons);
    // Defensa: la predicción del run debe ser la misma banda HIGH evaluada (nunca otra política).
    const risk = score.experimentalRisk;
    if (!risk || risk.level !== 'HIGH' || risk.policyHash !== policy?.policyHash) {
      throw new RetentionNotEligibleException([retentionIneligibility('PREDICTION_NOT_LATEST')]);
    }

    const outcome = await this.deps.contacts.insertIfAbsent({
      reservationId: reservation.reservationId,
      clientId: reservation.clientId,
      clinicId: reservation.clinicId,
      appointmentAt: reservation.appointmentAt,
      retentionStatus: 'CAMPAIGN_SENT',
      contactedAt: now,
      requestId: input.requestId,
      actorKind: 'INTERNAL_SERVICE',
      actorUserId: null,
      predictionRunId: score.predictionRunId,
      predictionResultId: score.resultId,
      modelKey: score.modelKey,
      modelVersion: score.modelVersion,
      researchPolicyHash: risk.policyHash,
      researchPolicyVersion: risk.policyVersion,
      riskBandAtContact: 'HIGH',
      probabilityNoShowAtContact: score.probabilityNoShow,
      scoredAt: score.scoredAt,
      eligibilityRuleVersion: RETENTION_ELIGIBILITY_RULE_VERSION,
    });
    // Carrera: otra petición registró el contacto entre la lectura y el INSERT.
    if (!outcome.created) return this.replayOrConflict(outcome.record, input);
    return { contact: outcome.record, replayed: false };
  }

  private replayOrConflict(
    existing: RetentionContact,
    input: RecordRetentionContactInput,
  ): RecordRetentionContactResult {
    if (!sameRequest(existing, input)) {
      throw new RetentionContactConflictException({
        contactId: existing.contactId,
        contactedAt: existing.contactedAt.toISOString(),
        modelKey: existing.modelKey,
        predictionRunId: existing.predictionRunId,
      });
    }
    return { contact: existing, replayed: true };
  }
}
