import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/env.validation';

/*
 * Sending SMS, behind one interface so the provider can be chosen later
 * without touching the code that sends (decided on 2026-11-20). Only the
 * "console" provider exists for now; env.validation.ts refuses it in
 * production, because it writes the messages (and their codes) in the logs.
 */

export interface SmsSender {
  /** `to` is an E.164 number; resolves once the provider accepted it. */
  send(to: string, text: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

/** Development only: writes the SMS in the API logs instead of sending it. */
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  send(to: string, text: string): Promise<void> {
    this.logger.log(`To ${to}: ${text}`);
    return Promise.resolve();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SMS_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>): SmsSender => {
        const provider = config.get('SMS_PROVIDER', { infer: true });
        switch (provider) {
          case 'console':
            return new ConsoleSmsSender();
        }
      },
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
