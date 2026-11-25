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
  status: string;
  entityType: EntityType;
  category: { id: string; name: string };
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  location: {
    type: LocationType;
    visibility: "PUBLIC" | "APPROXIMATE";
    commune: { id: string; name: string };
    point: { lat: number; lng: number } | null;
    accuracyM: number | null;
    addressHint: string | null;
    servedCommunes: { id: string; name: string }[];
  } | null;
}

export interface OwnPhoto {
  id: string;
  status: string;
  isCover: boolean;
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
  PENDING: "En attente de modération",
  PUBLISHED: "Publiée",
  REJECTED: "Refusée",
  SUSPENDED: "Suspendue",
  ARCHIVED: "Archivée",
};
