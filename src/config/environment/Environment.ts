import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { EnvironmentSchema } from './EnvironmentSchema.js';

if (existsSync('.env')) {
  loadEnvFile();
}

const result = EnvironmentSchema.safeParse(process.env);

if (!result.success) {
  console.error(
    'Configuración del entorno inválida',
    z.flattenError(result.error).fieldErrors,
  );
  throw new Error('Configuración del entorno inválida');
}

export const Environment = Object.freeze(result.data);
