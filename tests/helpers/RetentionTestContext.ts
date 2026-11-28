/**
 * Contexto de pruebas de incorporación de reservas y gestión de retención: casos de uso REALES
 * (ImportReservations, PriorityClientQuery, listado, exportación y registro de contacto) sobre
 * dobles en memoria, reloj fijo y datos 100 % sintéticos. Sin BD, sin red y sin servicio ML.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildApp } from '../../src/app/BuildApp.js';
import { CachedMlModelCatalog } from '../../src/infrastructure/http/ml/CachedMlModelCatalog.js';
import { CachedResearchPolicyCatalog } from '../../src/infrastructure/http/ml/CachedResearchPolicyCatalog.js';
import type { MlResearchPredictionResponse } from '../../src/infrastructure/http/ml/MlContractTypes.js';
import { EXPERIMENTAL_RISK_LABELS } from '../../src/infrastructure/http/ml/MlResearchContractSchemas.js';
import { bandImpliedByContract } from '../../src/infrastructure/http/ml/MlResearchContractValidator.js';
import { ExportPriorityClients } from '../../src/modules/CustomerRetention/ExportPriorityClients/application/ExportPriorityClients.js';
import { ListPriorityClients } from '../../src/modules/CustomerRetention/ListPriorityClients/application/ListPriorityClients.js';
import { RecordRetentionContact } from '../../src/modules/CustomerRetention/RecordRetentionContact/application/RecordRetentionContact.js';
import {
  PriorityClientQuery,
  type PriorityClientFilters,
} from '../../src/modules/CustomerRetention/Shared/query/PriorityClientQuery.js';
import { ImportReservations } from '../../src/modules/ReservationImport/ImportReservations/application/ImportReservations.js';
import { ImportedBookingEvidenceSource } from '../../src/modules/ReservationImport/Shared/evidence/ImportedBookingEvidenceSource.js';
import { toNewModelScore } from '../../src/modules/ReservationRisk/Shared/calculation/ToNewModelScore.js';
import { CompositeBookingEvidenceSource } from '../../src/modules/ReservationRisk/Shared/persistence/CompositeBookingEvidenceSource.js';
import { PendingValidationRiskLevelPolicy } from '../../src/modules/ReservationRisk/Shared/policy/PendingValidationRiskLevelPolicy.js';
import type { Reservation } from '../../src/modules/Reservations/Shared/models/Reservation.js';
import { CompositeReservationSource } from '../../src/modules/Reservations/Shared/persistence/CompositeReservationSource.js';
import { ScoredReservationRepository } from '../../src/modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import { sha256Hex } from '../../src/shared/security/VerifyInternalApiKey.js';
import { healthyCheck, TEST_INTERNAL_API_KEY } from './BuildTestApp.js';
import { FakeBookingEvidenceSource } from './FakeBookingEvidenceSource.js';
import { FakeImportReferenceReader } from './FakeImportReferenceReader.js';
import { FakePredictionClient } from './FakePredictionClient.js';
import { FixedClock } from './FixedClock.js';
import { InMemoryClientHistoryRepository } from './InMemoryClientHistoryRepository.js';
import { InMemoryOperationalStore } from './InMemoryOperationalStore.js';
import { InMemoryPredictiveStore } from './InMemoryPredictiveStore.js';
import { InMemoryReservationSource } from './InMemoryReservationRepository.js';
import { InMemoryReservationImportStore } from './InMemoryReservationImportStore.js';
import { InMemoryRetentionContactRepository } from './InMemoryRetentionContactRepository.js';
import { loadMlGolden } from './LoadFixture.js';
import {
  makeReservation,
  makeStoredSnapshot,
  makeVerifiedSnapshot,
} from './MakeSyntheticReservation.js';

/** Instante de consulta: 2026-11-10 10:00 en Lima (UTC-5). Ventana hasta 2026-11-13T15:00Z. */
export const NOW = new Date('2026-11-10T15:00:00.000Z');
export const HOUR_MS = 3_600_000;
export const ALL_CLINICS = { kind: 'ALL_CLINICS' } as const;
export const MODE = 'READ_ONLY_EXISTING_SCHEDULE' as const;

export type ModelAlias = 'rf' | 'xgb';
export const MODEL_KEYS = { rf: 'random_forest_full_v1', xgb: 'xgboost_full_v1' } as const;

export function createRetentionContext(options: { now?: Date; exportBatchSize?: number } = {}) {
  const store = new InMemoryPredictiveStore();
  const operations = new InMemoryOperationalStore();
  const primary = new InMemoryReservationSource();
  const imports = new InMemoryReservationImportStore();
  const references = new FakeImportReferenceReader();
  const contacts = new InMemoryRetentionContactRepository();
  const clock = new FixedClock(options.now ?? NOW);
  const reservations = new ScoredReservationRepository(
    new CompositeReservationSource(primary, imports, references),
    store,
    operations,
  );
  const evidence = new CompositeBookingEvidenceSource(
    new FakeBookingEvidenceSource('CAPTURED_AT_BOOKING'),
    new ImportedBookingEvidenceSource(imports, references, MODE),
  );
  const query = new PriorityClientQuery({ reservations, scores: store, contacts, mode: MODE });
  let batchSequence = 0;

  return {
    store,
    operations,
    primary,
    imports,
    references,
    contacts,
    clock,
    reservations,
    evidence,
    query,
    importer: new ImportReservations({
      references,
      imported: imports,
      limits: { maxFileBytes: 1024 * 1024, maxRows: 200 },
      clock,
      newBatchId: () => `00000000-0000-4000-8000-${String((batchSequence += 1)).padStart(12, '0')}`,
    }),
    list: new ListPriorityClients(query, clock),
    exporter: new ExportPriorityClients(query, clock, options.exportBatchSize),
    record: new RecordRetentionContact({
      reservations,
      scores: store,
      runs: store,
      contacts,
      mode: MODE,
      clock,
    }),
    /** Reserva de la FUENTE principal (también colisiona para la importación). */
    addSourceReservation(overrides: Partial<Reservation>): Reservation {
      const reservation = makeReservation(overrides);
      primary.reservations.set(reservation.reservationId, reservation);
      references.sourceReservationIds.add(reservation.reservationId);
      return reservation;
    },
  };
}

export type RetentionContext = ReturnType<typeof createRetentionContext>;

export function filters(overrides: Partial<PriorityClientFilters> = {}): PriorityClientFilters {
  return {
    modelKey: MODEL_KEYS.xgb,
    clinicId: null,
    retentionStatus: null,
    sort: 'appointmentAt',
    direction: 'asc',
    clinicScope: ALL_CLINICS,
    ...overrides,
  };
}

/** Contacto ya registrado (siembra directa del doble, sin pasar por el caso de uso). */
export async function seedContact(ctx: RetentionContext, reservationId: string): Promise<void> {
  await ctx.contacts.insertIfAbsent({
    reservationId,
    clientId: '900000000002001',
    clinicId: 1,
    appointmentAt: hoursFromNow(5),
    retentionStatus: 'CAMPAIGN_SENT',
    contactedAt: NOW,
    requestId: 'seed',
    actorKind: 'INTERNAL_SERVICE',
    actorUserId: null,
    predictionRunId: 'seed-run',
    predictionResultId: '1',
    modelKey: 'xgboost_full_v1',
    modelVersion: 'v',
    researchPolicyHash: 'x',
    researchPolicyVersion: 'v',
    riskBandAtContact: 'HIGH',
    probabilityNoShowAtContact: 0.8,
    scoredAt: NOW,
    eligibilityRuleVersion: 'retention_priority_v1',
  });
}

export function hoursFromNow(hours: number, now: Date = NOW): Date {
  return new Date(now.getTime() + hours * HOUR_MS);
}

/**
 * Persiste un run v2 con la probabilidad indicada; la banda la deriva la regla publicada en el
 * golden (como valida el contrato real). `policyHash` permite simular una política anterior.
 */
export async function scoreReservation(
  store: InMemoryPredictiveStore,
  reservationId: string,
  params: { model: ModelAlias; probability: number; scoredAt?: Date; policyHash?: string },
): Promise<string> {
  const {
    snapshotId: _s,
    createdAt: _c,
    ...rest
  } = makeStoredSnapshot({
    verified: makeVerifiedSnapshot({ reservationId }),
  });
  const snapshot = await store.saveIfAbsent({
    ...rest,
    evidence: {},
    sourceIngestionBatchId: null,
  });
  const golden = loadMlGolden<MlResearchPredictionResponse>(`golden_v2_predict_${params.model}`);
  const level = bandImpliedByContract(params.probability, golden.experimental_risk);
  const response: MlResearchPredictionResponse = {
    ...golden,
    probability_no_show: params.probability,
    experimental_risk: {
      ...golden.experimental_risk,
      level,
      label: EXPERIMENTAL_RISK_LABELS[level],
      ...(params.policyHash ? { policy_hash: params.policyHash } : {}),
    },
  };
  const scoredAt = params.scoredAt ?? new Date('2026-11-09T12:00:00.000Z');
  const runUid = randomUUID();
  await store.saveRun(
    {
      runUid,
      snapshotId: snapshot.snapshotId,
      reservationId,
      mode: 'single',
      requestedModelKeys: [MODEL_KEYS[params.model]],
      requestId: 'retention-test',
      runRequestedAt: scoredAt,
      completedAt: scoredAt,
      mlLatencyMs: 1,
      scoringApiVersion: 'v2',
    },
    [toNewModelScore(response, snapshot, scoredAt, new PendingValidationRiskLevelPolicy())],
  );
  return runUid;
}

export const IMPORT_HEADERS = [
  'DiaryGID',
  'DiaryGClientID',
  'DiaryGClinicID',
  'DiaryGDate',
  'DiaryGStart',
  'DiaryGEnd',
  'DiaryGCreated',
  'DiaryGNotAttended',
  'DiaryGFWA',
  'DiaryZoneIDs',
  'cantidad_reprogramaciones',
] as const;

export type ImportRow = Record<(typeof IMPORT_HEADERS)[number], string>;

/** Fila sintética válida respecto de NOW (cita mañana, creada antes del corte del historial). */
export function importRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    DiaryGID: '900000000701001',
    DiaryGClientID: '900000000702001',
    DiaryGClinicID: '1',
    DiaryGDate: '2026-11-11',
    DiaryGStart: '10:00',
    DiaryGEnd: '10:40',
    DiaryGCreated: '2026-11-05 09:30',
    DiaryGNotAttended: '0',
    DiaryGFWA: '0',
    DiaryZoneIDs: '900101',
    cantidad_reprogramaciones: '0',
    ...overrides,
  };
}

export function toCsv(rows: readonly ImportRow[], delimiter = ','): Uint8Array {
  const lines = [
    IMPORT_HEADERS.join(delimiter),
    ...rows.map((row) => IMPORT_HEADERS.map((h) => row[h]).join(delimiter)),
  ];
  return new TextEncoder().encode(`${lines.join('\r\n')}\r\n`);
}

export function importInput(filename: string, data: Uint8Array) {
  return { file: { filename, data }, clinicScope: ALL_CLINICS, requestId: 'import-test' };
}

/** Cuerpo multipart/form-data con un archivo (y campos extra opcionales) para app.inject. */
export function multipartBody(
  filename: string,
  data: Uint8Array,
  options: { field?: string; extraFields?: Record<string, string> } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----retention-test-boundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(options.extraFields ?? {})) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${options.field ?? 'file'}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** App Fastify completa (compuerta, esquemas, errores) con el contexto de retención. */
export function buildRetentionApp(ctx: RetentionContext): FastifyInstance {
  const ml = new FakePredictionClient();
  return buildApp({
    postgresHealthCheck: healthyCheck,
    mysqlHealthCheck: null,
    loggerInstance: pino({ level: 'silent' }) as unknown as FastifyBaseLogger,
    mlHealth: { client: ml, configured: true },
    predictiveApi: {
      internalApiKeySha256: sha256Hex(TEST_INTERNAL_API_KEY),
      dependencies: {
        reservations: ctx.reservations,
        history: new InMemoryClientHistoryRepository(),
        snapshots: ctx.store,
        results: ctx.store,
        scores: ctx.store,
        runs: ctx.store,
        operations: ctx.operations,
        evidenceSource: ctx.evidence,
        ml,
        modelCatalog: new CachedMlModelCatalog(ml, 60_000),
        research: {
          enabled: true,
          catalog: new CachedResearchPolicyCatalog(ml, { ttlMs: 60_000, expectedPolicyHashes: [] }),
        },
        policy: new PendingValidationRiskLevelPolicy(),
        mode: MODE,
        clock: ctx.clock,
        reservationImport: {
          imported: ctx.imports,
          references: ctx.references,
          limits: { maxFileBytes: 64 * 1024, maxRows: 200 },
        },
        retentionContacts: ctx.contacts,
      },
    },
  });
}
