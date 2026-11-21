import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { ThrottleService } from './throttle.service';

/*
 * Deletes rows that only accumulate: expired sessions, stale sign-in counters
 * and old SMS codes (code review of 2026-11-20: the purge used to run only at
 * sign-in, so a quiet day kept everything). Every instance runs it every hour;
 * the deletes are idempotent, so several instances do not get in each other's
 * way. No scheduler dependency is needed for one hourly job.
 */

export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class MaintenanceService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly otp: OtpService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), MAINTENANCE_INTERVAL_MS);
    // Does not keep the process alive on its own (tests, shutdown).
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass; a failure is logged and the next hour tries again. */
  async run(): Promise<void> {
    try {
      await Promise.all([
        this.sessions.purgeExpired(),
        this.throttle.purgeStale(),
        this.otp.purgeExpired(),
      ]);
    } catch (error) {
      this.logger.error(`Maintenance failed: ${(error as Error).message}`);
    }
  }
}
