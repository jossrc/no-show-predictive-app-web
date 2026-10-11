import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function fixturePath(relative: string): string {
  return path.join(TESTS_ROOT, relative);
}

export function loadJsonFixture<T = unknown>(relative: string): T {
  return JSON.parse(readFileSync(fixturePath(relative), 'utf8')) as T;
}

/** Cuerpo de un golden ML sintético (tests/fixtures/ml/*.json). Copia profunda en cada llamada. */
export function loadMlGolden<T = Record<string, unknown>>(name: string): T {
  return structuredClone(loadJsonFixture<{ body: T }>(`fixtures/ml/${name}.json`).body);
}
