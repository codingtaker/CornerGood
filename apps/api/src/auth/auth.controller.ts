import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { AppEnvironment } from '../config/env.validation';
import { InvalidInputError, readSignIn, readSignUp } from './account-input';
import { CurrentUser, readCookie, SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './credentials';
import { SESSION_COOKIE, SessionService } from './session.service';

/** The same answer for an unknown number, a wrong password or a closed account. */
const SIGN_IN_FAILED = 'Numéro ou mot de passe incorrect.';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  /** Creates a PROFESSIONAL account and signs it in. */
  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthenticatedUser }> {
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthenticatedUser }> {
    const input = readSignIn(body);
    const user = input ? await this.auth.signIn(input) : null;
    if (!user) throw new UnauthorizedException({ message: SIGN_IN_FAILED });
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

  private async startSession(userId: string, response: Response) {
    await this.sessions.purgeExpired();
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
