import type { Clock } from '../../../../shared/time/Clock.js';
import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import { loadAccessibleReservation } from '../../../ReservationRisk/Shared/access/LoadAccessibleReservation.js';
import { PreventiveActionRequiredException } from '../../Shared/errors/PreventiveActionRequiredException.js';
import { SpaceRecoveryAlreadyRecordedConflictException } from '../../Shared/errors/SpaceRecoveryAlreadyRecordedConflictException.js';
import type { SpaceRecoveryOutcome } from '../../Shared/models/OperationalRecords.js';
import type { OverbookingAuthorizationRepository } from '../../Shared/persistence/OverbookingAuthorizationRepository.js';
import type { SpaceRecoveryOutcomeRepository } from '../../Shared/persistence/SpaceRecoveryOutcomeRepository.js';
import type { RecordSpaceRecoveryOutcomeInput } from './input/RecordSpaceRecoveryOutcomeInput.js';
import type { RecordSpaceRecoveryOutcomeResult } from './result/RecordSpaceRecoveryOutcomeResult.js';

export interface RecordSpaceRecoveryOutcomeDependencies {
  readonly reservations: Pick<ReservationRepository, 'findById'>;
  readonly authorizations: Pick<OverbookingAuthorizationRepository, 'findByReservation'>;
  readonly recoveries: SpaceRecoveryOutcomeRepository;
  readonly clock: Clock;
}

/**
 * HU-08: registra explícitamente si el espacio de un horario GESTIONADO (marca HU-06 previa) se
 * recuperó (true) o no (false). No se infiere de la asistencia ni de otras citas, no depende de
 * HU-07 y no crea ni modifica citas. Sin gestión previa ⇒ 409 y cero INSERT.
 */
export class RecordSpaceRecoveryOutcome {
  constructor(private readonly deps: RecordSpaceRecoveryOutcomeDependencies) {}

  async execute(input: RecordSpaceRecoveryOutcomeInput): Promise<RecordSpaceRecoveryOutcomeResult> {
    const reservation = await loadAccessibleReservation(
      this.deps.reservations,
      input.reservationId,
      input.clinicScope,
    );
    const authorization = await this.deps.authorizations.findByReservation(
      reservation.reservationId,
    );
    if (!authorization) throw new PreventiveActionRequiredException();

    const existing = await this.deps.recoveries.findByReservation(reservation.reservationId);
    if (existing) return this.replayOrConflict(existing, input);

    // Horario y sede provienen de la autorización (mismo slot gestionado), no del cliente HTTP.
    const outcome = await this.deps.recoveries.insertIfAbsent({
      authorizationId: authorization.authorizationId,
      reservationId: authorization.reservationId,
      clinicId: authorization.clinicId,
      appointmentAt: authorization.appointmentAt,
      spaceRecovered: input.spaceRecovered,
      recordedAt: this.deps.clock.now(),
      requestId: input.requestId,
      actorKind: 'INTERNAL_SERVICE',
      actorUserId: null,
    });
    if (!outcome.created) return this.replayOrConflict(outcome.record, input);
    return { outcome: outcome.record, replayed: false };
  }

  private replayOrConflict(
    existing: SpaceRecoveryOutcome,
    input: RecordSpaceRecoveryOutcomeInput,
  ): RecordSpaceRecoveryOutcomeResult {
    if (existing.spaceRecovered !== input.spaceRecovered) {
      throw new SpaceRecoveryAlreadyRecordedConflictException({
        spaceRecovered: existing.spaceRecovered,
      });
    }
    return { outcome: existing, replayed: true };
  }
}
