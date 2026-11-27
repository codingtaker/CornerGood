import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { normalisePhone } from './account-input';
import { CurrentUser, Roles, RolesGuard, SessionGuard } from './auth.guard';
import type { AuthenticatedUser } from './credentials';
import { OtpService } from './otp.service';

/*
 * Password reset without SMS (ADR-037, kept beside the SMS codes): the
 * administrator checks who is calling, then reads a one-time code to them.
 * The person enters it on /mot-de-passe-oublie, as an SMS code. Administrator
 * only: whoever can issue a code can take over the account.
 */
@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
@Roles('ADMIN')
export class ResetCodeController {
  private readonly logger = new Logger(ResetCodeController.name);

  constructor(private readonly otp: OtpService) {}

  @Post('password-reset-codes')
  @HttpCode(201)
  async issue(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<{ code: string; expiresAt: Date; fullName: string }> {
    const raw =
      typeof body === 'object' && body !== null
        ? (body as { phone?: unknown }).phone
        : undefined;
    const phone = normalisePhone(raw);
    if (!phone) {
      throw new BadRequestException({
        message: 'Vérifiez les champs indiqués.',
        fields: { phone: 'Numéro invalide. Exemple : 90 12 34 56.' },
      });
    }
    const issued = await this.otp.issueForAdmin(phone);
    if (!issued) {
      throw new NotFoundException({
        message: 'Aucun compte professionnel actif ne porte ce numéro.',
      });
    }
    // Who gave a code, to whom: never the code itself.
    this.logger.log(
      `Administrator ${admin.id} issued a password reset code for ${phone}`,
    );
    return issued;
  }
}
