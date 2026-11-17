import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from './config/env.validation';

/**
 * Settings shared by the real server and the end-to-end tests,
 * so the tests exercise the same URLs and rules as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppEnvironment, true>);

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    // Sessions will travel in a cookie (ADR-021).
    credentials: true,
  });
}
