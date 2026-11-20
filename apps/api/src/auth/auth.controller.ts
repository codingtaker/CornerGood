import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { AppEnvironment } from '../config/env.validation';
import {
  InvalidInputError,
  readOtpRequest,
  readPasswordReset,
  readSignIn,
  readSignUp,
} from './account-input';
import { OTP_TTL_MINUTES, OtpService } from './otp.service';
import { CurrentUser, readCookie, SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './credentials';
import { SESSION_COOKIE, SessionService } from './session.service';
import { clientKey, tooManyAttemptsMessage } from './throttle';
import { ThrottleService } from './throttle.service';

/** The same answer for an unknown number, a wrong password or a closed account. */
const SIGN_IN_FAILED = 'Numéro ou mot de passe incorrect.';
/** Wrong, expired, used or out of tries: the same answer. */
const WRONG_CODE = { message: 'Code incorrect ou expiré.', field: 'code' };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly otp: OtpService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  /** Creates a PROFESSIONAL account and signs it in. */
  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    // Every attempt counts, before any work: sign-up hashes a password too.
    const ipKey = `register:ip:${clientKey(request.ip)}`;
    await this.refuseWhileBlocked([ipKey], response);
    await this.throttle.record(ipKey, this.throttle.policies.registerIp);

    let input;
    try {
      input = readSignUp(body);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw new BadRequestException({
          message: 'Vérifiez les champs indiqués.',
          fields: error.problems,
        });
      }
      throw error;
    }
    const user = await this.auth.signUp(input);
    await this.startSession(user.id, response);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    const input = readSignIn(body);
    const ipKey = `login:ip:${clientKey(request.ip)}`;
    // Keyed on the number typed, account or not: a block says nothing about
    // which numbers have an account.
    const phoneKey = input ? `login:phone:${input.phone}` : null;

    // Before checking the password: a blocked client costs no scrypt.
    await this.refuseWhileBlocked([ipKey], response);
    if (input && phoneKey && (await this.throttle.retryAfter([phoneKey])) > 0) {
      // The owner of the number lifts the block with a code sent to it by SMS:
      // whoever only knows the number can no longer lock its owner out.
      if (!input.code) {
        await this.refuseWhileBlocked([phoneKey], response, true);
      } else if (
        await this.otp.consume(input.phone, 'LOGIN_UNLOCK', input.code)
      ) {
        await this.throttle.clear(phoneKey);
      } else {
        await this.throttle.record(
          `otp:fail:ip:${clientKey(request.ip)}`,
          this.throttle.policies.otpFailureIp,
        );
        throw new BadRequestException(WRONG_CODE);
      }
    }

    const user = input ? await this.auth.signIn(input) : null;
    if (!user) {
      const { loginIp, loginPhone } = this.throttle.policies;
      await this.throttle.record(ipKey, loginIp);
      if (phoneKey) await this.throttle.record(phoneKey, loginPhone);
      throw new UnauthorizedException({ message: SIGN_IN_FAILED });
    }
    if (phoneKey) await this.throttle.clear(phoneKey);
    await this.startSession(user.id, response);
    return { user };
  }

  /**
   * Sends a code by SMS, to unlock sign-in or to reset the password. The
   * answer is the same whether the number has an account or not, and it does
   * not wait for the SMS, so neither its content nor its delay tells.
   */
  @Post('otp')
  @HttpCode(202)
  async requestCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    let input;
    try {
      input = readOtpRequest(body);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw new BadRequestException({
          message: 'Vérifiez les champs indiqués.',
          fields: error.problems,
        });
      }
      throw error;
    }

    // Each SMS costs money: limited per number and per address, every request
    // counted, whether the number has an account or not.
    const phoneKey = `otp:phone:${input.phone}`;
    const ipKey = `otp:ip:${clientKey(request.ip)}`;
    await this.refuseWhileBlocked([phoneKey, ipKey], response);
    const { otpPhone, otpIp } = this.throttle.policies;
    await this.throttle.record(phoneKey, otpPhone);
    await this.throttle.record(ipKey, otpIp);

    this.otp.issueInBackground(input.phone, input.purpose);
    return {
      message:
        'Si ce numéro a un compte, un code vient de lui être envoyé par SMS. ' +
        `Il est valable ${OTP_TTL_MINUTES} minutes.`,
    };
  }

  /** New password with a PASSWORD_RESET code; closes every other session. */
  @Post('password-reset')
  @HttpCode(200)
  async resetPassword(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    const failureKey = `otp:fail:ip:${clientKey(request.ip)}`;
    await this.refuseWhileBlocked([failureKey], response);

    let input;
    try {
      input = readPasswordReset(body);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw new BadRequestException({
          message: 'Vérifiez les champs indiqués.',
          fields: error.problems,
        });
      }
      throw error;
    }

    const userId = await this.otp.consume(
      input.phone,
      'PASSWORD_RESET',
      input.code,
    );
    if (!userId) {
      await this.throttle.record(
        failureKey,
        this.throttle.policies.otpFailureIp,
      );
      throw new BadRequestException(WRONG_CODE);
    }

    const user = await this.auth.setPassword(userId, input.password);
    await this.sessions.closeAll(userId);
    await this.throttle.clear(`login:phone:${input.phone}`);
    await this.startSession(user.id, response);
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await this.sessions.close(token);
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthenticatedUser): { user: AuthenticatedUser } {
    return { user };
  }

  /**
   * 429 with Retry-After while one of these keys is blocked. `unlockBySms`
   * tells the sign-in form it may offer a code by SMS instead of waiting.
   */
  private async refuseWhileBlocked(
    keys: string[],
    response: Response,
    unlockBySms = false,
  ): Promise<void> {
    const seconds = await this.throttle.retryAfter(keys);
    if (seconds > 0) {
      response.setHeader('Retry-After', String(seconds));
      throw new HttpException(
        {
          message: tooManyAttemptsMessage(seconds),
          retryAfterSeconds: seconds,
          ...(unlockBySms ? { unlockBySms: true } : {}),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async startSession(userId: string, response: Response) {
    await Promise.all([
      this.sessions.purgeExpired(),
      this.throttle.purgeStale(),
    ]);
    const { token, expiresAt } = await this.sessions.open(userId);
    response.cookie(SESSION_COOKIE, token, {
      ...this.cookieOptions(),
      expires: expiresAt,
    });
  }

  private cookieOptions(): CookieOptions {
    return {
      // Out of reach of page scripts, so an injected script cannot steal it.
      httpOnly: true,
      // Not sent with cross-site POSTs: protects the forms from CSRF.
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/',
    };
  }
}
