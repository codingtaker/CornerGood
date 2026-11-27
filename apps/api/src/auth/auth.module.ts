import { Module } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { AuthController } from './auth.controller';
import { ResetCodeController } from './reset-code.controller';
import { RolesGuard, SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MaintenanceService } from './maintenance.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { DEFAULT_THROTTLE_POLICIES, THROTTLE_POLICIES } from './throttle';
import { ThrottleService } from './throttle.service';

@Module({
  controllers: [AuthController, ResetCodeController],
  providers: [
    AuthService,
    SessionService,
    ThrottleService,
    OtpService,
    MaintenanceService,
    AccountDeletionService,
    { provide: THROTTLE_POLICIES, useValue: DEFAULT_THROTTLE_POLICIES },
    SessionGuard,
    RolesGuard,
  ],
  exports: [SessionService, ThrottleService, SessionGuard, RolesGuard],
})
export class AuthModule {}
