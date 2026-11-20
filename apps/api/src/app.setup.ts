import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { AppEnvironment } from './config/env.validation';
import { sameOriginJson } from './security/same-origin-json';

/**
 * Settings shared by the real server and the end-to-end tests,
 * so the tests exercise the same URLs and rules as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppEnvironment, true>);

  // request.ip is the visitor's address only when it comes from a trusted
  // proxy (the web app forwards /api/v1); the sign-in limits rely on it.
  (app.getHttpAdapter().getInstance() as Express).set(
    'trust proxy',
    config.get('TRUST_PROXY', { infer: true }),
  );
  // Registered before Nest's body parsers, so a refused form body is never
  // even parsed (code review of 2026-11-20, point 3).
  const webOrigin = config.get('WEB_ORIGIN', { infer: true });
  app.use(sameOriginJson([webOrigin]));
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.enableCors({
    origin: webOrigin,
    // Sessions will travel in a cookie (ADR-021).
    credentials: true,
  });
}
