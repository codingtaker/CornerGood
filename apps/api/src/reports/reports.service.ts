import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  PublicationStatus,
  ReportReason,
  ReportStatus,
  VerificationStatus,
} from '../database/database.types';
import { MAX_NOTE_LENGTH } from './report-input';
import type { ReportInput } from './report-input';

/** Slugs are made by listingSlug(): lowercase letters, digits and dashes. */
const SLUG = /^[a-z0-9-]{1,80}$/;

export interface ReportSummary {
  id: string;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: Date;
  listing: { id: string; name: string };
  handledBy: string | null;
}

export interface ReportDetail extends ReportSummary {
  description: string;
  /** Private: shown to the team only. */
  reporterContact: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  listing: {
    id: string;
    name: string;
    slug: string;
    status: PublicationStatus;
    verificationStatus: VerificationStatus;
  };
}

function invalidState(message: string): ConflictException {
  return new ConflictException({ code: 'INVALID_STATE', message });
}

/** The note that closes a report: required, trimmed, bounded. */
export function readNote(body: unknown): string {
  const raw =
    typeof body === 'object' && body !== null
      ? (body as { note?: unknown }).note
      : undefined;
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (note.length === 0 || note.length > MAX_NOTE_LENGTH) {
    throw new UnprocessableEntityException({
      code: 'NOTE_REQUIRED',
      message: `Notez ce qui a été constaté ou fait, en 1 à ${MAX_NOTE_LENGTH} caractères.`,
      fields: { note: 'Note requise.' },
    });
  }
  return note;
}

/**
 * Reports of visitors (ADR-017) and their handling by the team (contract
 * §6.5). Handling a report never changes the listing itself: a correction or
 * a suspension goes through its own action, with its own permission.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /**
   * A report on a published listing. A listing VERIFIED becomes
   * VERIFICATION_PENDING in the same transaction (ADR-018): its information is
   * no longer vouched for until someone checks it again.
   */
  async create(slug: string, input: ReportInput): Promise<{ id: string }> {
    if (!SLUG.test(slug)) {
      throw new NotFoundException({ message: 'Fiche introuvable.' });
    }
    return this.db.transaction().execute(async (trx) => {
      const listing = await trx
        .selectFrom('establishments')
        .select(['id', 'verification_status'])
        .where('slug', '=', slug)
        .where('publication_status', '=', 'PUBLISHED')
        .forUpdate()
        .executeTakeFirst();
      if (!listing) {
        throw new NotFoundException({ message: 'Fiche introuvable.' });
      }
      const report = await trx
        .insertInto('reports')
        .values({
          establishment_id: listing.id,
          reason: input.reason,
          description: input.description,
          reporter_contact: input.reporterContact,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (listing.verification_status === 'VERIFIED') {
        await trx
          .updateTable('establishments')
          .set({ verification_status: 'VERIFICATION_PENDING' })
          .where('id', '=', listing.id)
          .execute();
      }
      return { id: report.id };
    });
  }

  /** Open reports first, then those in review, then closed; oldest first. */
  async list(status?: ReportStatus): Promise<ReportSummary[]> {
    let query = this.db
      .selectFrom('reports')
      .innerJoin(
        'establishments',
        'establishments.id',
        'reports.establishment_id',
      )
      .leftJoin('users', 'users.id', 'reports.handled_by_id')
      .select([
        'reports.id',
        'reports.reason',
        'reports.status',
        'reports.created_at',
        'establishments.id as listing_id',
        'establishments.name as listing_name',
        'users.full_name as handler',
      ])
      .orderBy(
        sql`CASE reports.status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END`,
      )
      .orderBy('reports.created_at')
      .limit(200);
    if (status) query = query.where('reports.status', '=', status);
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
      listing: { id: row.listing_id, name: row.listing_name },
      handledBy: row.handler,
    }));
  }

  async get(id: string): Promise<ReportDetail> {
    const row = await this.db
      .selectFrom('reports')
      .innerJoin(
        'establishments',
        'establishments.id',
        'reports.establishment_id',
      )
      .leftJoin('users', 'users.id', 'reports.handled_by_id')
      .select([
        'reports.id',
        'reports.reason',
        'reports.status',
        'reports.description',
        'reports.reporter_contact',
        'reports.resolution_note',
        'reports.created_at',
        'reports.resolved_at',
        'establishments.id as listing_id',
        'establishments.name as listing_name',
        'establishments.slug as listing_slug',
        'establishments.publication_status as listing_status',
        'establishments.verification_status as listing_verification',
        'users.full_name as handler',
      ])
      .where('reports.id', '=', id)
      .executeTakeFirst();
    if (!row)
      throw new NotFoundException({ message: 'Signalement introuvable.' });
    return {
      id: row.id,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
      description: row.description,
      reporterContact: row.reporter_contact,
      resolutionNote: row.resolution_note,
      resolvedAt: row.resolved_at,
      handledBy: row.handler,
      listing: {
        id: row.listing_id,
        name: row.listing_name,
        slug: row.listing_slug,
        status: row.listing_status,
        verificationStatus: row.listing_verification,
      },
    };
  }

  /** OPEN → IN_REVIEW, assigned to the caller. */
  async take(actorId: string, id: string): Promise<ReportDetail> {
    await this.db.transaction().execute(async (trx) => {
      const report = await this.lock(trx, id);
      if (report.status !== 'OPEN') {
        throw invalidState('Ce signalement est déjà pris en charge ou clos.');
      }
      await trx
        .updateTable('reports')
        .set({ status: 'IN_REVIEW', handled_by_id: actorId })
        .where('id', '=', id)
        .execute();
    });
    return this.get(id);
  }

  /** OPEN or IN_REVIEW → RESOLVED or DISMISSED, with its note. */
  async close(
    actorId: string,
    id: string,
    status: 'RESOLVED' | 'DISMISSED',
    note: string,
  ): Promise<ReportDetail> {
    await this.db.transaction().execute(async (trx) => {
      const report = await this.lock(trx, id);
      if (report.status !== 'OPEN' && report.status !== 'IN_REVIEW') {
        throw invalidState('Ce signalement est déjà clos.');
      }
      await trx
        .updateTable('reports')
        .set({
          status,
          resolution_note: note,
          resolved_at: sql<Date>`now()`,
          // Whoever closes it is the one who answers for it.
          handled_by_id: actorId,
        })
        .where('id', '=', id)
        .execute();
    });
    return this.get(id);
  }

  private async lock(
    trx: Kysely<Database>,
    id: string,
  ): Promise<{ status: ReportStatus }> {
    const report = await trx
      .selectFrom('reports')
      .select('status')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!report) {
      throw new NotFoundException({ message: 'Signalement introuvable.' });
    }
    return report;
  }
}
