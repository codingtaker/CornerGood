/** Shapes shared by the listing pages and the API answers (S3). */

export type LocationType = "FIXED" | "MOBILE" | "HOME_BASED";
export type EntityType = "BUSINESS" | "COMMUNITY";

export interface Commune {
  id: string;
  slug: string;
  name: string;
  prefecture: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  applicableTo: EntityType | null;
}

export interface OwnListing {
  id: string;
  name: string;
  /** The public address once published: /fiches/{slug}. */
  slug: string;
  status: string;
  entityType: EntityType;
  category: { id: string; name: string };
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** Why the listing was refused, until it is sent again. */
  rejection: { reason: string; at: string } | null;
  location: {
    type: LocationType;
    visibility: "PUBLIC" | "APPROXIMATE";
    commune: { id: string; name: string };
    point: { lat: number; lng: number } | null;
    accuracyM: number | null;
    capturedAt: string | null;
    source: "DEVICE_GPS" | "MANUAL_PIN" | "ADMIN" | null;
    addressHint: string | null;
    servedCommunes: { id: string; name: string }[];
  } | null;
}

export interface OwnPhoto {
  id: string;
  status: string;
  isCover: boolean;
  /** Why a moderator refused it. */
  rejectionReason: string | null;
}

/** Photos one listing may have (ADR-040), as in the API. */
export const MAX_PHOTOS = 6;

export const PHOTO_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente de validation",
  APPROVED: "Validée",
  REJECTED: "Refusée",
};

export const LOCATION_LABELS: Record<LocationType, string> = {
  FIXED: "Lieu fixe (boutique, atelier, kiosque…)",
  HOME_BASED: "À domicile",
  MOBILE: "Activité mobile (je me déplace)",
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  PENDING: "En attente de validation",
  PUBLISHED: "Publiée",
  REJECTED: "Refusée",
  SUSPENDED: "Suspendue",
  ARCHIVED: "Archivée",
};

/** Longest reason of a refusal, as in the API. */
export const MAX_REASON_LENGTH = 500;

/** One listing awaiting a decision (back-office, S4). */
export interface QueuedListing {
  id: string;
  name: string;
  entityType: EntityType;
  category: string;
  commune: string | null;
  locationType: LocationType | null;
  submittedAt: string;
  pendingPhotos: number;
}

export interface LogEntry {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  mediaId: string | null;
  actor: { name: string; role: string };
  at: string;
}

/** What a moderator sees to decide: private data, photos and history. */
export interface ModerationListing extends OwnListing {
  owner: { name: string; phone: string | null } | null;
  publishedAt: string | null;
  photos: OwnPhoto[];
  log: LogEntry[];
}

export const ACTION_LABELS: Record<string, string> = {
  SUBMIT: "Envoyée pour validation",
  EDIT: "Modifiée",
  APPROVE: "Publiée",
  REJECT: "Refusée",
  APPROVE_MEDIA: "Photo validée",
  REJECT_MEDIA: "Photo refusée",
  ARCHIVE: "Archivée",
};

export const SOURCE_LABELS: Record<string, string> = {
  DEVICE_GPS: "GPS du téléphone",
  MANUAL_PIN: "Placée à la main sur la carte",
  ADMIN: "Saisie par l'administration",
};

/** "26/11/2026 14:05", in Lomé time. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Africa/Lome",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** What anyone sees of a published listing: GET /listings/{slug}. */
export interface PublicListing {
  slug: string;
  name: string;
  entityType: EntityType;
  category: { slug: string; name: string };
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  verificationStatus: string;
  publishedAt: string | null;
  updatedAt: string;
  location: {
    type: LocationType;
    commune: { slug: string; name: string };
    /** Exact for a fixed place, the centre of a sector for a home. */
    position: { lat: number; lng: number } | null;
    approximate: boolean;
    addressHint: string | null;
    servedCommunes: { slug: string; name: string }[];
  } | null;
  photos: { id: string; isCover: boolean }[];
}
