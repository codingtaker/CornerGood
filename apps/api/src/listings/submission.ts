import type { EntityType, LocationType } from '../database/database.types';

/*
 * What a listing needs before it is sent for validation (RM-008, ADR-045).
 * Mirrors the database constraint submitted_listing_is_complete, so that what
 * is missing is named rather than refused by the database.
 */
export interface SubmissionCandidate {
  entityType: EntityType;
  categoryActive: boolean;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** The primary location. */
  location: {
    type: LocationType;
    hasPoint: boolean;
    servedCommunes: number;
  } | null;
}

/** French messages by field; empty when the listing can be submitted. */
export function missingForSubmission(
  listing: SubmissionCandidate,
): Record<string, string> {
  const missing: Record<string, string> = {};
  if (!listing.categoryActive) {
    missing.categoryId = "Cette catégorie n'est plus proposée.";
  }
  if (!listing.description?.trim()) {
    missing.description = 'Décrivez en quelques mots ce que vous proposez.';
  }
  // A community place may have no number of its own (ADR-045).
  if (
    listing.entityType === 'BUSINESS' &&
    !listing.phone &&
    !listing.whatsapp
  ) {
    missing.phone = 'Indiquez un numéro de téléphone ou WhatsApp.';
  }
  const { location } = listing;
  if (!location) {
    missing.location = 'Indiquez où se trouve votre activité.';
  } else if (location.type === 'FIXED' && !location.hasPoint) {
    missing.location = 'Relevez la position de votre activité.';
  } else if (location.type === 'MOBILE' && location.servedCommunes === 0) {
    missing.location = 'Choisissez au moins une commune où vous intervenez.';
  }
  return missing;
}
