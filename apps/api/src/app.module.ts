import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { ListingsController } from './listings/listings.controller';
import { ListingsService } from './listings/listings.service';
import { MediaModule } from './media/media.module';
import { SmsModule } from './sms/sms.module';
import { AdminController } from './spaces/spaces.controllers';
import { TerritoryController } from './territory/territory.controller';
import { TerritoryService } from './territory/territory.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The API is started from apps/api, while .env lives at the repository root.
      envFilePath: ['../../.env'],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    SmsModule,
    AuthModule,
    MediaModule,
  ],
  controllers: [
    HealthController,
    TerritoryController,
    ListingsController,
    AdminController,
  ],
  providers: [TerritoryService, ListingsService],
})
export class AppModule {}
