import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The API is started from apps/api, while .env lives at the repository root.
      envFilePath: ['../../.env'],
      validate: validateEnvironment,
    }),
    DatabaseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
