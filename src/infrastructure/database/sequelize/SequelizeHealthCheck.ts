import type { Sequelize } from 'sequelize-typescript';

export class SequelizeHealthCheck {
  constructor(private readonly sequelize: Sequelize) {}

  async check(): Promise<void> {
    await this.sequelize.authenticate();
  }
}
