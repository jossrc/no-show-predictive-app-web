import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fixturePath } from '../../helpers/LoadFixture.js';

/**
 * Verificación automática de fronteras (Screaming Architecture + Vertical Slices).
 * TypeScript 7 (nativo) no expone API JS de AST: se usa un escáner léxico que descarta
 * comentarios respetando strings/templates, y luego extrae especificadores de import/export.
 * Así no hay falsos positivos por palabras en comentarios.
 */
const ROOT = path.resolve(fixturePath('.'), '..');
const SRC = path.join(ROOT, 'src');

interface SourceFile {
  readonly relative: string;
  readonly code: string;
  readonly imports: readonly string[];
  readonly lines: number;
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Elimina comentarios // y /* *\/ conservando literales (incluidos templates). */
export function stripComments(source: string): string {
  let output = '';
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (quote) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const comment = source.slice(index, end === -1 ? source.length : end + 2);
      output += comment.replace(/[^\n]/g, ' ');
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    output += char;
    index += 1;
  }
  return output;
}

function extractImports(code: string): string[] {
  const patterns = [
    /(?:^|[;\n])\s*(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1]!));
}

function loadSources(): SourceFile[] {
  return walk(SRC)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const source = readFileSync(file, 'utf8');
      const code = stripComments(source);
      return {
        relative: path.relative(ROOT, file).split(path.sep).join('/'),
        code,
        imports: extractImports(code),
        lines: source.split('\n').length,
      };
    });
}

function resolveImport(from: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;
  return path.posix
    .normalize(path.posix.join(path.posix.dirname(from), specifier))
    .replace(/\.js$/, '.ts');
}

function moduleOf(relative: string): { module: string; feature: string } | null {
  const match = /^src\/modules\/([^/]+)\/([^/]+)/.exec(relative);
  return match ? { module: match[1]!, feature: match[2]! } : null;
}

const sources = loadSources();
const violations = (check: (file: SourceFile) => string[]): string[] => sources.flatMap(check);

describe('Arquitectura: fronteras de módulos y capas (src/**)', () => {
  it('el escáner ignora comentarios pero conserva imports reales', () => {
    const code = stripComments(
      "// import x from 'fastify'\n/* from 'pg' */ import { y } from './y.js';\nconst s = '// no es comentario';",
    );
    assert.deepEqual(extractImports(code), ['./y.js']);
    assert.match(code, /no es comentario/);
  });

  it('application/ no conoce Fastify ni presentation/http', () => {
    const found = violations((file) =>
      file.relative.includes('/application/')
        ? file.imports
            .filter(
              (spec) =>
                spec === 'fastify' ||
                spec.startsWith('fastify/') ||
                spec.includes('/presentation/'),
            )
            .map((spec) => `${file.relative} → ${spec}`)
        : [],
    );
    assert.deepEqual(found, []);
  });

  it('handlers no importan sequelize/pg ni persistencia concreta, ni contienen SQL', () => {
    const found = violations((file) => {
      if (!file.relative.includes('/presentation/http/handler/')) return [];
      const bad = file.imports
        .filter(
          (spec) =>
            /^(sequelize|sequelize-typescript|pg)$/.test(spec) || spec.includes('/persistence/'),
        )
        .map((spec) => `${file.relative} → ${spec}`);
      if (/\bSELECT\b[\s\S]*\bFROM\b|\bINSERT\s+INTO\b/i.test(file.code))
        bad.push(`${file.relative}: SQL en handler`);
      return bad;
    });
    assert.deepEqual(found, []);
  });

  it('routes solo registran método/path/schema/handler: sin SQL, persistencia ni fetch a Python', () => {
    const found = violations((file) => {
      if (!file.relative.includes('/presentation/http/route/')) return [];
      const bad = file.imports
        .filter(
          (spec) =>
            spec.includes('/persistence/') ||
            spec.includes('infrastructure/http/ml') ||
            /^(pg|sequelize)/.test(spec),
        )
        .map((spec) => `${file.relative} → ${spec}`);
      if (/\bfetch\s*\(/.test(file.code)) bad.push(`${file.relative}: fetch en route`);
      if (/\bSELECT\b[\s\S]*\bFROM\b/i.test(file.code)) bad.push(`${file.relative}: SQL en route`);
      return bad;
    });
    assert.deepEqual(found, []);
  });

  it('sin carpetas globales controllers/services/repositories para lógica funcional', () => {
    for (const forbidden of ['controllers', 'services', 'repositories']) {
      assert.equal(existsSync(path.join(SRC, forbidden)), false, forbidden);
    }
  });

  it('ningún test dentro de src/ y no existe el directorio singular test/', () => {
    const tests = walk(SRC).filter(
      (file) => /\.(test|spec)\.ts$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`),
    );
    assert.deepEqual(tests, []);
    assert.equal(existsSync(path.join(ROOT, 'test')), false);
  });

  it('un módulo no importa carpetas privadas (features) de otro módulo: solo su Shared', () => {
    const found = violations((file) => {
      const owner = moduleOf(file.relative);
      if (!owner) return [];
      return file.imports
        .map((spec) => resolveImport(file.relative, spec))
        .filter((target) => {
          const dependency = moduleOf(target);
          return (
            dependency && dependency.module !== owner.module && dependency.feature !== 'Shared'
          );
        })
        .map((target) => `${file.relative} → ${target}`);
    });
    assert.deepEqual(found, []);
  });

  it('dependencias entre módulos son acíclicas y en el sentido acordado', () => {
    const allowed: Record<string, readonly string[]> = {
      Health: [],
      FlowMigration: [],
      Reservations: [],
      ClientHistory: ['Reservations'],
      ReservationRisk: ['Reservations', 'ClientHistory'],
      PredictionModels: ['ReservationRisk'],
    };
    const found = violations((file) => {
      const owner = moduleOf(file.relative);
      if (!owner) return [];
      return file.imports
        .map((spec) => moduleOf(resolveImport(file.relative, spec)))
        .filter(
          (dep): dep is { module: string; feature: string } =>
            dep !== null && dep.module !== owner.module,
        )
        .filter((dep) => !(allowed[owner.module] ?? []).includes(dep.module))
        .map((dep) => `${owner.module} → ${dep.module} (${file.relative})`);
    });
    assert.deepEqual(found, []);
  });

  it('infrastructure/ y shared/ no dependen de módulos de negocio', () => {
    const found = violations((file) =>
      /^src\/(infrastructure|shared)\//.test(file.relative)
        ? file.imports
            .filter((spec) => resolveImport(file.relative, spec).startsWith('src/modules/'))
            .map((spec) => `${file.relative} → ${spec}`)
        : [],
    );
    assert.deepEqual(found, []);
  });

  it('prohibido sync({alter|force}) y DROP/ALTER/TRUNCATE sobre raw_flow o analytics (src y migraciones app)', () => {
    const migrationDir = path.join(ROOT, 'migrations/postgres/app');
    const migrationFiles = readdirSync(migrationDir).map((file) => ({
      relative: `migrations/postgres/app/${file}`,
      code: readFileSync(path.join(migrationDir, file), 'utf8').replace(/--.*$/gm, ''),
    }));
    const destructive =
      /\b(DROP|ALTER|TRUNCATE)\s+(TABLE|SCHEMA|VIEW)\s+(IF\s+EXISTS\s+)?(raw_flow|analytics)\b/i;
    // Excepción justificada: la migración FLOWww preexistente (npm run migrate:flow) ES el
    // cargador de raw_flow; se preserva intacta y nunca se invoca desde el runtime del Sprint 01.
    const preexistingFlowLoader = new Set([
      'src/app/cli/MigrateFlow.ts',
      'src/modules/FlowMigration/MigrateFlowTable.ts',
    ]);
    const found = [
      ...sources.filter((file) => !preexistingFlowLoader.has(file.relative)),
      ...migrationFiles,
    ].flatMap((file) => {
      const bad: string[] = [];
      if (/\.sync\s*\(\s*\{[^}]*\b(alter|force)\s*:\s*true/.test(file.code))
        bad.push(`${file.relative}: sync alter/force`);
      if (destructive.test(file.code))
        bad.push(`${file.relative}: DDL destructivo sobre esquema fuente`);
      if (/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(raw_flow|analytics)\./i.test(file.code)) {
        bad.push(`${file.relative}: escritura en esquema fuente`);
      }
      return bad;
    });
    assert.deepEqual(found, []);
  });

  it('RiskFeaturesBuilder y el historial as-of no usan client_history_current ni el target', () => {
    const asOfFiles = sources.filter((file) =>
      /ReservationRisk\/Shared\/calculation\/|ClientHistory\/Shared\/persistence\//.test(
        file.relative,
      ),
    );
    assert.ok(asOfFiles.length > 0);
    const found = asOfFiles.flatMap((file) => {
      const bad: string[] = [];
      if (/client_history_current|appointment_training_dataset_v1/.test(file.code))
        bad.push(`${file.relative}: fuente prohibida`);
      if (/\btarget\b|no_show_uid_minus_one/.test(file.code))
        bad.push(`${file.relative}: referencia al target`);
      return bad;
    });
    assert.deepEqual(found, []);
  });

  it('archivos acotados: ninguno nuevo supera 450 líneas (los >300 se informan)', () => {
    const tooLarge = sources.filter(
      (file) =>
        file.lines > 450 &&
        !file.relative.includes('FlowMigration') &&
        !file.relative.endsWith('MigrateFlow.ts'),
    );
    assert.deepEqual(
      tooLarge.map((file) => `${file.relative} (${file.lines})`),
      [],
    );
    const large = sources
      .filter((file) => file.lines > 300)
      .map((file) => `${file.relative} (${file.lines})`);
    if (large.length > 0) console.log(`[info] archivos >300 líneas: ${large.join(', ')}`);
  });
});
