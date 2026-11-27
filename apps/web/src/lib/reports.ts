/** Reports of visitors and their handling (ADR-017, contract §6.5). */

export const REPORT_REASONS = [
  "WRONG_INFO",
  "CLOSED",
  "WRONG_LOCATION",
  "DUPLICATE",
  "INAPPROPRIATE",
  "OTHER",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REASON_LABELS: Record<ReportReason, string> = {
  WRONG_INFO: "Une information est fausse (téléphone, description…)",
  CLOSED: "L'activité a fermé",
  WRONG_LOCATION: "Le lieu est mal placé",
  DUPLICATE: "Cette activité a déjà une autre fiche",
  INAPPROPRIATE: "Le contenu est inapproprié",
  OTHER: "Autre chose",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  OPEN: "À traiter",
  IN_REVIEW: "Pris en charge",
  RESOLVED: "Résolu",
  DISMISSED: "Classé",
};

/** Same limits as the API. */
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_CONTACT_LENGTH = 120;
export const MAX_NOTE_LENGTH = 1000;

export interface ReportSummary {
  id: string;
  reason: ReportReason;
  status: string;
  createdAt: string;
  listing: { id: string; name: string };
  handledBy: string | null;
}

export interface ReportDetail extends ReportSummary {
  description: string;
  reporterContact: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  listing: {
    id: string;
    name: string;
    slug: string;
    status: string;
    verificationStatus: string;
  };
}
