import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RolesGuard, SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { DEFAULT_THROTTLE_POLICIES, THROTTLE_POLICIES } from './throttle';
import { ThrottleService } from './throttle.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    ThrottleService,
    OtpService,
    { provide: THROTTLE_POLICIES, useValue: DEFAULT_THROTTLE_POLICIES },
    SessionGuard,
    RolesGuard,
  ],
  exports: [SessionService, SessionGuard, RolesGuard],
})
export class AuthModule {}
