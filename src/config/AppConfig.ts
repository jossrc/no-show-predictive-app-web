import { Environment } from './environment/Environment.js';

export interface AppConfig {
  port: number;
  host: string;
  version: string;
}

export const appConfig = {
  port: Environment.PORT,
  host: Environment.HOST,
  version: '1.0.0',
} as const satisfies AppConfig;
