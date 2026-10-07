import type { ValidationErrorSource } from './ValidationErrorSource.js';

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  source: ValidationErrorSource;
}
