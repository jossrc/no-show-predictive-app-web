import { LIMA_TIME_ZONE } from '../../../../shared/time/LimaTime.js';
import {
  toScoreSummaryBody,
  type ScoreSummaryBody,
} from '../../../Reservations/Shared/http/ReservationHttpMapper.js';
import type { ReservationOrigin } from '../../../Reservations/Shared/models/Reservation.js';
import { EXPERIMENTAL_RISK_NOTICE } from '../../../ReservationRisk/Shared/http/RiskAssessmentHttpMapper.js';
import type { RetentionContact } from '../models/RetentionContact.js';
import type { PriorityClient, ResolvedPriorityClientQuery } from '../query/PriorityClientQuery.js';
import { RETENTION_ELIGIBILITY_RULE_VERSION } from '../rules/RetentionEligibility.js';
import { RETENTION_STATUS_LABELS, type RetentionStatus } from '../rules/RetentionStatus.js';

export interface PriorityClientBody {
  clientId: string;
  reservationId: string;
  clinicId: number;
  appointmentAt: string;
  reservationStatus: 'SCHEDULED';
  origin: ReservationOrigin;
  importBatchId: string | null;
  prediction: ScoreSummaryBody;
  retention: {
    status: RetentionStatus;
    statusLabel: string;
    contactId: string | null;
    contactedAt: string | null;
    contactModelKey: string | null;
    contactPredictionRunId: string | null;
  };
}

export interface RetentionQueryContextBody {
  window: {
    ruleVersion: string;
    hours: number;
    startExclusive: string;
    endInclusive: string;
    timeZone: string;
  };
  sort: { field: string; direction: 'asc' | 'desc'; modelKey: string; semantics: string };
  filters: { clinicId: number | null; retentionStatus: RetentionStatus | null };
  experimentalClassificationUnavailable: boolean;
  experimentalRiskPolicy: {
    modelKey: string;
    policyId: string;
    policyVersion: string;
    policyHash: string;
    status: 'RESEARCH_PROVISIONAL';
    classificationBasis: 'RESEARCH_PROVISIONAL';
    operationalUseAllowed: false;
    notice: string;
  } | null;
}

export interface RetentionContactBody {
  contactId: string;
  reservationId: string;
  clientId: string;
  clinicId: number;
  appointmentAt: string;
  retentionStatus: 'CAMPAIGN_SENT';
  retentionStatusLabel: string;
  contactedAt: string;
  modelKey: string;
  modelVersion: string;
  predictionRunId: string;
  riskBandAtContact: 'HIGH';
  probabilityNoShowAtContact: number;
  researchPolicyHash: string;
  researchPolicyVersion: string;
  scoredAt: string;
  eligibilityRuleVersion: string;
  communicationSent: false;
  actorKind: 'INTERNAL_SERVICE';
  actorUserId: null;
}

export function toPriorityClientBody(item: PriorityClient): PriorityClientBody {
  const { reservation, contact } = item;
  return {
    clientId: reservation.clientId,
    reservationId: reservation.reservationId,
    clinicId: reservation.clinicId,
    appointmentAt: reservation.appointmentAt.toISOString(),
    reservationStatus: 'SCHEDULED',
    origin: reservation.origin ?? 'SOURCE',
    importBatchId: reservation.importBatchId ?? null,
    prediction: toScoreSummaryBody(item.score),
    retention: {
      status: item.retentionStatus,
      statusLabel: RETENTION_STATUS_LABELS[item.retentionStatus],
      contactId: contact?.contactId ?? null,
      contactedAt: contact?.contactedAt.toISOString() ?? null,
      contactModelKey: contact?.modelKey ?? null,
      contactPredictionRunId: contact?.predictionRunId ?? null,
    },
  };
}

export function toQueryContextBody(query: ResolvedPriorityClientQuery): RetentionQueryContextBody {
  const { filters, window, policy } = query;
  return {
    window: {
      ruleVersion: RETENTION_ELIGIBILITY_RULE_VERSION,
      hours: window.hours,
      startExclusive: window.startExclusive.toISOString(),
      endInclusive: window.endInclusive.toISOString(),
      timeZone: LIMA_TIME_ZONE,
    },
    sort: {
      field: filters.sort,
      direction: filters.direction,
      modelKey: filters.modelKey,
      semantics: filters.sort === 'appointmentAt' ? 'CHRONOLOGICAL' : 'EXPLORATORY_SCORE_ORDER',
    },
    filters: { clinicId: filters.clinicId, retentionStatus: filters.retentionStatus },
    experimentalClassificationUnavailable: policy === null,
    experimentalRiskPolicy: policy
      ? {
          modelKey: filters.modelKey,
          ...policy,
          status: 'RESEARCH_PROVISIONAL',
          classificationBasis: 'RESEARCH_PROVISIONAL',
          operationalUseAllowed: false,
          notice: EXPERIMENTAL_RISK_NOTICE,
        }
      : null,
  };
}

export function toRetentionContactBody(contact: RetentionContact): RetentionContactBody {
  return {
    contactId: contact.contactId,
    reservationId: contact.reservationId,
    clientId: contact.clientId,
    clinicId: contact.clinicId,
    appointmentAt: contact.appointmentAt.toISOString(),
    retentionStatus: contact.retentionStatus,
    retentionStatusLabel: RETENTION_STATUS_LABELS[contact.retentionStatus],
    contactedAt: contact.contactedAt.toISOString(),
    modelKey: contact.modelKey,
    modelVersion: contact.modelVersion,
    predictionRunId: contact.predictionRunId,
    riskBandAtContact: contact.riskBandAtContact,
    probabilityNoShowAtContact: contact.probabilityNoShowAtContact,
    researchPolicyHash: contact.researchPolicyHash,
    researchPolicyVersion: contact.researchPolicyVersion,
    scoredAt: contact.scoredAt.toISOString(),
    eligibilityRuleVersion: contact.eligibilityRuleVersion,
    communicationSent: false,
    actorKind: contact.actorKind,
    actorUserId: contact.actorUserId,
  };
}
