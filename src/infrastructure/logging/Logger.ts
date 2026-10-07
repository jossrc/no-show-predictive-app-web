import pino from 'pino';
import { Environment } from '../../config/environment/Environment.js';
import { createLoggerConfig } from './LoggerConfig.js';

const loggerConfig = createLoggerConfig(
  Environment.NODE_ENV,
  Environment.LOG_LEVEL,
);

export const logger = pino(loggerConfig);
