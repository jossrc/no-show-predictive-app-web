import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExperimentalRiskSummary } from '../../../../../../src/modules/Reservations/Shared/models/ReservationScoreSummary.js';
import type { ReservationListCriteria } from '../../../../../../src/modules/Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../../../../../../src/modules/Reservations/Shared/persistence/ReservationScoreReader.js';
import {
  MAX_RANKING_CANDIDATES,
  ScoredReservationRepository,
} from '../../../../../../src/modules/Reservations/Shared/persistence/ScoredReservationRepository.js';
import { InvalidReservationQueryException } from '../../../../../../src/modules/Reservations/Shared/errors/InvalidReservationQueryException.js';
import { InMemoryReservationSource } from '../../../../../helpers/InMemoryReservationRepository.js';
import { makeReservation } from '../../../../../helpers/MakeSyntheticReservation.js';

const POLICY = '1d58ce962e899b758275f7191244225e8c970cf2db9661ffcb21be9b63a4ce74';
const OLD_POLICY = 'e'.repeat(64);

interface Seed {
  id: string;
  at: string;
  p: number | null;
  level?: ExperimentalRiskSummary['level'];
  policy?: string;
  clinicId?: number;
}

const SEEDS: Seed[] = [
  { id: '900000000001001', at: '2026-11-02T15:00:00Z', p: 0.3, level: 'LOW', policy: POLICY },
  { id: '900000000001002', at: '2026-11-03T15:00:00Z', p: 0.3, level: 'LOW', policy: POLICY },
  {
    id: '900000000001003',
    at: '2026-11-04T15:00:00Z',
    p: 0.9,
    level: 'HIGH',
    policy: POLICY,
    clinicId: 2,
  },
  { id: '900000000001004', at: '2026-11-05T15:00:00Z', p: 0.45, level: 'MEDIUM', policy: POLICY },
  { id: '900000000001005', at: '2026-11-06T15:00:00Z', p: 0.6, level: 'HIGH', policy: OLD_POLICY },
  { id: '900000000001006', at: '2026-11-07T15:00:00Z', p: 0.55 },
  { id: '900000000001007', at: '2026-11-01T15:00:00Z', p: null },
  { id: '900000000001008', at: '2026-11-08T15:00:00Z', p: null },
  { id: '900000000001009', at: '2026-12-15T15:00:00Z', p: 0.99, level: 'HIGH', policy: POLICY },
];

/** Lector de scores mínimo (semántica del SQLite: último score por modelo de cada reserva). */
function scoreReader(seeds: readonly Seed[]): ReservationScoreReader & { rankCalls: number } {
  const scored = seeds.filter((s) => s.p !== null);
  return {
    rankCalls: 0,
    isAvailable: async () => true,
    latestScores: async (ids) =>
      new Map(
        scored
          .filter((s) => ids.includes(s.id))
          .map((s) => [
            s.id,
            [
              {
                modelKey: 'random_forest_full_v1' as const,
                modelVersion: 'random_forest_full_v1:4e3c86a17005',
                modelHash: '4e3c86a17005',
                probabilityNoShow: s.p!,
                scoredAt: new Date('2026-10-20Z'),
                predictionRunId: `run-${s.id}`,
                experimentalRisk: s.level
                  ? {
                      level: s.level,
                      label: 'Bajo (exploratorio)' as const,
                      status: 'RESEARCH_PROVISIONAL' as const,
                      policyId: 'p',
                      policyVersion: 'research_risk_v1_1',
                      policyHash: s.policy!,
                    }
                  : null,
              },
            ],
          ]),
      ),
    reservationsWithUsableSnapshot: async (ids) =>
      new Set(scored.filter((s) => ids.includes(s.id)).map((s) => s.id)),
    async rankLatest(criteria) {
      this.rankCalls += 1;
      return scored
        .filter(
          (s) =>
            !criteria.probabilityRange ||
            (s.p! >= criteria.probabilityRange.minInclusive &&
              s.p! < criteria.probabilityRange.maxExclusive),
        )
        .filter(
          (s) =>
            criteria.experimentalPolicyHash === null ||
            s.policy === criteria.experimentalPolicyHash,
        )
        .filter(
          (s) =>
            criteria.experimentalRiskLevel === null || s.level === criteria.experimentalRiskLevel,
        )
        .map((s) => ({ reservationId: s.id, probability: s.p! }));
    },
    currentExperimentalPolicy: async () => ({
      policyId: 'p',
      policyVersion: 'research_risk_v1_1',
      policyHash: POLICY,
    }),
  };
}

function setup(seeds: readonly Seed[] = SEEDS) {
  const source = new InMemoryReservationSource();
  for (const seed of seeds) {
    source.reservations.set(
      seed.id,
      makeReservation({
        reservationId: seed.id,
        appointmentAt: new Date(seed.at),
        clinicId: seed.clinicId ?? 1,
      }),
    );
  }
  const reader = scoreReader(seeds);
  return { source, reader, repository: new ScoredReservationRepository(source, reader) };
}

function criteria(overrides: Partial<ReservationListCriteria> = {}): ReservationListCriteria {
  return {
    startInclusive: new Date('2026-11-01T05:00:00Z'),
    endExclusive: new Date('2026-12-01T05:00:00Z'),
    status: 'SCHEDULED',
    clinicId: null,
    clinicScope: { kind: 'ALL_CLINICS' },
    sortField: 'appointmentAt',
    sortDirection: 'asc',
    modelKey: 'random_forest_full_v1',
    probabilityRange: null,
    experimentalPolicyHash: POLICY,
    experimentalRiskLevel: null,
    snapshotEvidence: 'SYNTHETIC_DEMO_ONLY',
    after: null,
    limit: 25,
    ...overrides,
  };
}

async function pageThrough(
  repository: ScoredReservationRepository,
  base: Partial<ReservationListCriteria>,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let after: ReservationListCriteria['after'] = null;
  let pages = 0;
  for (; pages < 50;) {
    const page = await repository.list(criteria({ ...base, limit, after }));
    pages += 1;
    ids.push(...page.rows.map((row) => row.reservation.reservationId));
    const last = page.rows.at(-1);
    if (!page.hasMore || !last) break;
    after = {
      probability: base.sortField === 'appointmentAt' ? undefined : last.sortProbability,
      appointmentAt: last.reservation.appointmentAt,
      reservationId: last.reservation.reservationId,
    };
  }
  return { ids, pages };
}

const short = (ids: string[]) => ids.map((id) => id.slice(-2));

describe('ScoredReservationRepository (fuente PG solo lectura + scores del almacén local)', () => {
  it('orden por score DESC: ranking GLOBAL, NULLS LAST, desempate (fecha, id) y fuera de período excluido', async () => {
    const { repository } = setup();
    const page = await repository.list(
      criteria({ sortField: 'probabilityNoShow', sortDirection: 'desc' }),
    );
    assert.deepEqual(short(page.rows.map((r) => r.reservation.reservationId)), [
      '03',
      '05',
      '06',
      '04',
      '01',
      '02',
      '07',
      '08',
    ]);
    assert.deepEqual(
      page.rows.map((r) => r.sortProbability),
      [0.9, 0.6, 0.55, 0.45, 0.3, 0.3, null, null],
    );
    assert.equal(page.hasMore, false);
  });

  it('paginación 1..N por score: misma secuencia con cualquier tamaño de página, sin duplicados ni saltos', async () => {
    const { repository } = setup();
    const full = (
      await repository.list(criteria({ sortField: 'probabilityNoShow', sortDirection: 'desc' }))
    ).rows.map((r) => r.reservation.reservationId);
    for (const limit of [1, 2, 3, 5, 7, 8, 100]) {
      const { ids, pages } = await pageThrough(
        repository,
        { sortField: 'probabilityNoShow', sortDirection: 'desc' },
        limit,
      );
      assert.deepEqual(ids, full, `limit ${limit}`);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(
        pages,
        Math.max(1, Math.ceil(full.length / limit)),
        `páginas con limit ${limit}`,
      );
    }
    const asc = await pageThrough(
      repository,
      { sortField: 'probabilityNoShow', sortDirection: 'asc' },
      3,
    );
    assert.deepEqual(short(asc.ids), ['01', '02', '04', '06', '05', '03', '07', '08']);
  });

  it('orden por banda experimental: solo la política vigente, otras políticas y v1 al final (sin mezclar)', async () => {
    const { repository } = setup();
    const { ids } = await pageThrough(
      repository,
      { sortField: 'experimentalRisk', sortDirection: 'desc' },
      2,
    );
    // 05 tiene banda de OTRA política y 06 no tiene banda: cola cronológica junto a los no puntuados.
    assert.deepEqual(short(ids), ['03', '04', '01', '02', '07', '05', '06', '08']);
  });

  it('filtro por banda experimental del modelo elegido: exacto, con fecha y paginado', async () => {
    const { repository } = setup();
    const high = await repository.list(criteria({ experimentalRiskLevel: 'HIGH' }));
    assert.deepEqual(
      short(high.rows.map((r) => r.reservation.reservationId)),
      ['03'],
      '05 es de otra política; 09 fuera de período',
    );
    const low = await pageThrough(repository, { experimentalRiskLevel: 'LOW' }, 1);
    assert.deepEqual(short(low.ids), ['01', '02']);
    const lowByScore = await repository.list(
      criteria({
        experimentalRiskLevel: 'LOW',
        sortField: 'probabilityNoShow',
        sortDirection: 'desc',
      }),
    );
    assert.deepEqual(
      short(lowByScore.rows.map((r) => r.reservation.reservationId)),
      ['01', '02'],
      'sin cola NULLS LAST con filtro',
    );
    const noPolicy = await repository.list(
      criteria({ experimentalRiskLevel: 'LOW', experimentalPolicyHash: null }),
    );
    assert.deepEqual(noPolicy.rows, [], 'sin política vigente no hay bandas que filtrar');
  });

  it('los filtros de negocio (sede, alcance, período) los aplica SIEMPRE la fuente, también al ordenar por score', async () => {
    const { repository } = setup();
    const scoped = await repository.list(
      criteria({
        sortField: 'probabilityNoShow',
        sortDirection: 'desc',
        clinicScope: { kind: 'CLINICS', clinicIds: [2] },
      }),
    );
    assert.deepEqual(short(scoped.rows.map((r) => r.reservation.reservationId)), ['03']);
    const clinic1 = await repository.list(criteria({ experimentalRiskLevel: 'HIGH', clinicId: 1 }));
    assert.deepEqual(clinic1.rows, []);
  });

  it('cronológico: una consulta a la fuente por página y scores adjuntos por lote (sin N+1)', async () => {
    const { repository, source, reader } = setup();
    source.listCalls = 0;
    const page = await repository.list(criteria({ limit: 3 }));
    assert.equal(source.listCalls, 1);
    assert.equal(reader.rankCalls, 0, 'sin ranking cuando no se ordena/filtra por score');
    assert.deepEqual(short(page.rows.map((r) => r.reservation.reservationId)), ['07', '01', '02']);
    assert.deepEqual(
      page.rows.map((r) => r.sortProbability),
      [null, 0.3, 0.3],
    );
    assert.equal(page.rows[1]?.scores[0]?.experimentalRisk?.level, 'LOW');
    assert.equal(page.hasMore, true);
  });

  it('más candidatos que el tope de ranking ⇒ 422 RANKING_CANDIDATES_EXCEEDED (nunca orden parcial)', async () => {
    const { source } = setup([]);
    const huge: ReservationScoreReader = {
      ...scoreReader([]),
      rankLatest: async () =>
        Array.from({ length: MAX_RANKING_CANDIDATES + 1 }, (_, i) => ({
          reservationId: String(9e14 + i),
          probability: 0.5,
        })),
    };
    await assert.rejects(
      () =>
        new ScoredReservationRepository(source, huge).list(
          criteria({ sortField: 'probabilityNoShow' }),
        ),
      (error: unknown) =>
        error instanceof InvalidReservationQueryException &&
        error.code === 'RANKING_CANDIDATES_EXCEEDED',
    );
  });
});
