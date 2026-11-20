import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AdminController, ProController } from './spaces/spaces.controllers';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The API is started from apps/api, while .env lives at the repository root.
      envFilePath: ['../../.env'],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
  ],
  controllers: [HealthController, ProController, AdminController],
})
export class AppModule {}
