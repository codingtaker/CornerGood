import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import type { AppEnvironment } from '../config/env.validation';
import { LocalDiskStorage, MEDIA_STORAGE } from './media-storage';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** Global: deleting an account also deletes its photos (auth module). */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) =>
        new LocalDiskStorage(config.get('MEDIA_DIR', { infer: true })),
    },
  ],
  exports: [MediaService, MEDIA_STORAGE],
})
export class MediaModule {}
