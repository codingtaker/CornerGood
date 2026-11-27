import { Kysely, sql } from 'kysely';

/*
 * Handling of reports (contract §6.5, ADR-017).
 *
 * 1. reports.resolution_note: what was found or done, required to close a
 *    report as RESOLVED or DISMISSED, so the team keeps a trace.
 * 2. A report taken in hand names who handles it.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE reports
      ADD COLUMN resolution_note text,
      -- "IS NOT NULL" is required: a CHECK that evaluates to NULL is accepted.
      ADD CONSTRAINT closed_report_has_note CHECK (
        status NOT IN ('RESOLVED', 'DISMISSED')
        OR (resolution_note IS NOT NULL
            AND char_length(btrim(resolution_note)) BETWEEN 1 AND 1000)
      ),
      ADD CONSTRAINT handled_report_has_handler CHECK (
        status = 'OPEN' OR handled_by_id IS NOT NULL
      );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE reports
      DROP CONSTRAINT handled_report_has_handler,
      DROP CONSTRAINT closed_report_has_note,
      DROP COLUMN resolution_note;
  `.execute(db);
}
