import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserRole } from '../database/database.types';
import { AuthenticatedUser } from './credentials';
import { SESSION_COOKIE, SessionService } from './session.service';

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/** Reads one cookie from the Cookie header (no cookie-parser needed). */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      // A malformed %-sequence ("%E0%A4%A") makes decodeURIComponent throw:
      // such a cookie opens no session, like a missing one (review point 4).
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 401 without a valid session; otherwise puts the user on the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const user = token ? await this.sessions.findUser(token) : null;
    if (!user) {
      throw new UnauthorizedException({
        message: 'Connectez-vous pour continuer.',
      });
    }
    request.user = user;
    return true;
  }
}

const ROLES_KEY = 'roles';
/** Roles allowed on a route; use after SessionGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** 403 when the signed-in user's role is not one of the route's roles. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // A route behind this guard without @Roles is a mistake: refuse.
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!roles || !user || !roles.includes(user.role)) {
      throw new ForbiddenException({
        message: "Vous n'avez pas accès à cet espace.",
      });
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>()
      .user as AuthenticatedUser,
);
