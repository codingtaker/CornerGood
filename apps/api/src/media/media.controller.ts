import {
  ArgumentsHost,
  BadRequestException,
  CanActivate,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  HttpException,
  Injectable,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  CurrentUser,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/credentials';
import { tooManyAttemptsMessage } from '../auth/throttle';
import { ThrottleService } from '../auth/throttle.service';
import { MediaService } from './media.service';
import type { OwnPhoto } from './media.service';
import { MAX_PHOTO_BYTES } from './photo-processor';

const Uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** Counts every upload of an account, before its body is read. */
@Injectable()
export class UploadThrottleGuard implements CanActivate {
  constructor(private readonly throttle: ThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const user = http.getRequest<AuthenticatedRequest>().user;
    if (!user) return false;
    const key = `media:user:${user.id}`;
    const seconds = await this.throttle.retryAfter([key]);
    if (seconds > 0) {
      http.getResponse<Response>().setHeader('Retry-After', String(seconds));
      throw new HttpException(
        { message: tooManyAttemptsMessage(seconds) },
        429,
      );
    }
    await this.throttle.record(key, this.throttle.policies.mediaUser);
    return true;
  }
}

/** multer's own refusals, in product words. */
@Catch(PayloadTooLargeException, BadRequestException)
export class UploadErrorFilter implements ExceptionFilter {
  catch(error: HttpException, host: ArgumentsHost): void {
    const status = error.getStatus();
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        message:
          status === 413
            ? 'Cette photo dépasse 5 Mo.'
            : 'Envoyez une seule photo, dans le champ « file ».',
      });
  }
}

/** Photos of the professional's own listings (S4, ADR-019). */
@Controller('pro/listings/:id/media')
@UseGuards(SessionGuard, RolesGuard)
@Roles('PROFESSIONAL', 'MODERATOR', 'ADMIN')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(UploadThrottleGuard)
  @UseFilters(UploadErrorFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ photo: OwnPhoto }> {
    if (!file) throw new BadRequestException();
    return { photo: await this.media.add(user.id, id, file.buffer) };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
  ): Promise<{ photos: OwnPhoto[] }> {
    return { photos: await this.media.list(user.id, id) };
  }

  /** Not cached (no-store on every answer): this photo may not be public. */
  @Get(':mediaId')
  @Header('Content-Disposition', 'inline')
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @Param('mediaId', Uuid()) mediaId: string,
  ): Promise<StreamableFile> {
    const photo = await this.media.read(user.id, id, mediaId);
    return new StreamableFile(photo, {
      type: 'image/webp',
      length: photo.length,
    });
  }

  @Delete(':mediaId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @Param('mediaId', Uuid()) mediaId: string,
  ): Promise<void> {
    await this.media.remove(user.id, id, mediaId);
  }
}
