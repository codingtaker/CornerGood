import { InvalidInputError } from '../auth/account-input';
import type { ReportReason } from '../database/database.types';

export const REPORT_REASONS: readonly ReportReason[] = [
  'WRONG_INFO',
  'CLOSED',
  'WRONG_LOCATION',
  'DUPLICATE',
  'INAPPROPRIATE',
  'OTHER',
];

export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_CONTACT_LENGTH = 120;
export const MAX_NOTE_LENGTH = 1000;

export interface ReportInput {
  reason: ReportReason;
  description: string;
  /** How to reach the person, if they wish: never shown to the public. */
  reporterContact: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** What a visitor sends from the public page (ADR-017). */
export function readReport(body: unknown): ReportInput {
  const raw =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const problems: Record<string, string> = {};

  const reason = REPORT_REASONS.find((value) => value === raw.reason);
  if (!reason) problems.reason = 'Choisissez ce qui ne va pas.';

  const description = text(raw.description);
  if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    problems.description = `Expliquez le problème en 1 à ${MAX_DESCRIPTION_LENGTH} caractères.`;
  }

  const contact = text(raw.reporterContact);
  if (contact.length > MAX_CONTACT_LENGTH) {
    problems.reporterContact = `Le contact compte au plus ${MAX_CONTACT_LENGTH} caractères.`;
  }

  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return {
    reason: reason as ReportReason,
    description,
    reporterContact: contact === '' ? null : contact,
  };
}
