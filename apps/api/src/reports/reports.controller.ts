import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InvalidInputError } from '../auth/account-input';
import {
  CurrentUser,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/credentials';
import { clientKey, tooManyAttemptsMessage } from '../auth/throttle';
import { ThrottleService } from '../auth/throttle.service';
import type { ReportStatus } from '../database/database.types';
import { readReport } from './report-input';
import { readNote, ReportsService } from './reports.service';
import type { ReportDetail, ReportSummary } from './reports.service';

const Uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const STATUSES: readonly ReportStatus[] = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED',
  'DISMISSED',
];

/** Every report counts, accepted or not: 5 per hour per address (§9). */
@Injectable()
export class ReportThrottleGuard implements CanActivate {
  constructor(private readonly throttle: ThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const key = `report:ip:${clientKey(http.getRequest<Request>().ip)}`;
    const seconds = await this.throttle.retryAfter([key]);
    if (seconds > 0) {
      http.getResponse<Response>().setHeader('Retry-After', String(seconds));
      throw new HttpException(
        { message: tooManyAttemptsMessage(seconds) },
        429,
      );
    }
    await this.throttle.record(key, this.throttle.policies.reportIp);
    return true;
  }
}

/** A visitor reports a published listing, with or without an account. */
@Controller('listings/:slug/reports')
export class PublicReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ReportThrottleGuard)
  async create(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    let input;
    try {
      input = readReport(body);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw new BadRequestException({
          message: 'Vérifiez les champs indiqués.',
          fields: error.problems,
        });
      }
      throw error;
    }
    return this.reports.create(slug, input);
  }
}

/** The team reads and handles reports (contract §6.5). */
@Controller('admin/reports')
@UseGuards(SessionGuard, RolesGuard)
@Roles('MODERATOR', 'ADMIN')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  async list(
    @Query('status') status: unknown,
  ): Promise<{ reports: ReportSummary[] }> {
    const filter = STATUSES.find((value) => value === status);
    return { reports: await this.reports.list(filter) };
  }

  @Get(':id')
  async get(
    @Param('id', Uuid()) id: string,
  ): Promise<{ report: ReportDetail }> {
    return { report: await this.reports.get(id) };
  }

  @Post(':id/take')
  @HttpCode(200)
  async take(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
  ): Promise<{ report: ReportDetail }> {
    return { report: await this.reports.take(user.id, id) };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @Body() body: unknown,
  ): Promise<{ report: ReportDetail }> {
    const note = readNote(body);
    return {
      report: await this.reports.close(user.id, id, 'RESOLVED', note),
    };
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @Body() body: unknown,
  ): Promise<{ report: ReportDetail }> {
    const note = readNote(body);
    return {
      report: await this.reports.close(user.id, id, 'DISMISSED', note),
    };
  }
}
