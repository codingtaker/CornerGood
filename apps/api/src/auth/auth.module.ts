import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RolesGuard, SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, SessionGuard, RolesGuard],
  exports: [SessionService, SessionGuard, RolesGuard],
})
export class AuthModule {}
