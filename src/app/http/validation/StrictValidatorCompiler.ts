import { Ajv } from 'ajv';
import type { FastifySchemaCompiler } from 'fastify';

/**
 * Compilador de validación SIN coerción de tipos para cuerpos de comandos (Sprint 02).
 * El Ajv por defecto de Fastify usa `coerceTypes: 'array'`, que convertiría `"true"` o `1` en
 * `true` y `"NO_SHOW"` en `["NO_SHOW"]`: aquí un booleano debe llegar como booleano JSON.
 * Los errores conservan el formato de Ajv, así que RegisterErrorHandler los traduce igual
 * (400 REQUEST_VALIDATION_ERROR con field/code/source).
 */
const strictAjv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  // Las anotaciones OpenAPI (examples, description) no son palabras clave de validación.
  strict: false,
});

export const strictValidatorCompiler: FastifySchemaCompiler<unknown> = ({ schema }) =>
  strictAjv.compile(schema as object);
