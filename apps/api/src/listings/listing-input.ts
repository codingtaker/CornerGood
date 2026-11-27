import { InvalidInputError, normalisePhone } from '../auth/account-input';
import type {
  EntityType,
  LocationType,
  PositionSource,
} from '../database/database.types';
import type { Point } from '../territory/territory.service';
import { readOpeningHours } from './opening-hours';
import type { OpeningHours } from './opening-hours';

/*
 * What the listing form sends (S3). Messages are product text, in French.
 * The rules of the three location types mirror the database constraints of
 * migration 0001 (location_type_rules), so a refusal is explained here rather
 * than failing in the database.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPES: readonly EntityType[] = ['BUSINESS', 'COMMUNITY'];
const LOCATION_TYPES: readonly LocationType[] = [
  'FIXED',
  'MOBILE',
  'HOME_BASED',
];
const SOURCES: readonly PositionSource[] = ['DEVICE_GPS', 'MANUAL_PIN'];
/** A plain check: one @, a dot in the domain, no spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Services one listing may tick, and the length of their details. */
export const MAX_SERVICES_PER_LISTING = 15;
export const MAX_SERVICE_DETAILS_LENGTH = 300;

/** Latitude and longitude in degrees, from numbers or query strings. */
export function readPoint(raw: { lat: unknown; lng: unknown }): Point | null {
  const toNumber = (value: unknown) =>
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  const lat = toNumber(raw.lat);
  const lng = toNumber(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export interface DraftLocationInput {
  type: LocationType;
  communeId: string;
  /** Required for FIXED, forbidden for MOBILE, optional for HOME_BASED. */
  point: Point | null;
  source: PositionSource | null;
  accuracyM: number | null;
  capturedAt: Date | null;
  addressHint: string | null;
  /** MOBILE only: the communes where the activity goes. */
  servedCommuneIds: string[];
}

export interface ListingDetailsInput {
  categoryId: string;
  name: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  openingHours: OpeningHours | null;
}

export interface DraftListingInput extends ListingDetailsInput {
  entityType: EntityType;
  location: DraftLocationInput;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim().replace(/[ \t]+/g, ' ')
    : null;
}

/** What the listing is, shared by its creation and its later changes. */
function readDetails(
  raw: Record<string, unknown>,
  problems: Record<string, string>,
): ListingDetailsInput {
  const categoryId =
    typeof raw.categoryId === 'string' && UUID.test(raw.categoryId)
      ? raw.categoryId
      : null;
  if (!categoryId) problems.categoryId = 'Choisissez une catégorie.';

  const name = optionalText(raw.name) ?? '';
  if (name.length < 2 || name.length > 120) {
    problems.name = 'Indiquez le nom (2 à 120 caractères).';
  }

  const description = optionalText(raw.description);
  if (description && description.length > 2000) {
    problems.description = 'La description compte au plus 2 000 caractères.';
  }

  const readOptionalPhone = (field: 'phone' | 'whatsapp') => {
    if (optionalText(raw[field]) === null) return null;
    const phone = normalisePhone(raw[field]);
    if (!phone) problems[field] = 'Numéro invalide. Exemple : 90 12 34 56.';
    return phone;
  };
  const phone = readOptionalPhone('phone');
  const whatsapp = readOptionalPhone('whatsapp');

  const email = optionalText(raw.email)?.toLowerCase() ?? null;
  if (email && (email.length > 254 || !EMAIL.test(email))) {
    problems.email = 'Adresse e-mail invalide. Exemple : nom@exemple.tg.';
  }

  let openingHours: OpeningHours | null = null;
  try {
    openingHours = readOpeningHours(raw.openingHours);
  } catch (error) {
    problems.openingHours = (error as Error).message;
  }

  return {
    categoryId: categoryId as string,
    name,
    description,
    phone,
    whatsapp,
    email,
    openingHours,
  };
}

/** The whole set of details: a field left empty is erased. */
export function readListingDetails(body: unknown): ListingDetailsInput {
  const problems: Record<string, string> = {};
  const details = readDetails(record(body), problems);
  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return details;
}

/**
 * The place of a listing, at its creation and when it is corrected. Errors are
 * keyed "location.<field>", as the form shows them.
 */
function readLocation(
  value: unknown,
  problems: Record<string, string>,
): DraftLocationInput {
  const location = record(value);
  const type = LOCATION_TYPES.find((value) => value === location.type);
  if (!type) problems['location.type'] = 'Choisissez le type de lieu.';

  const communeId =
    typeof location.communeId === 'string' && UUID.test(location.communeId)
      ? location.communeId
      : null;
  if (!communeId) problems['location.communeId'] = 'Choisissez la commune.';

  const hasPoint = location.point !== undefined && location.point !== null;
  const point = hasPoint ? readPoint(record(location.point) as never) : null;
  if (hasPoint && !point) problems['location.point'] = 'Position invalide.';

  const source = point
    ? (SOURCES.find((value) => value === location.source) ?? null)
    : null;
  if (point && !source) {
    problems['location.source'] = 'Indiquez comment la position a été relevée.';
  }

  let accuracyM: number | null = null;
  if (
    point &&
    location.accuracyM !== undefined &&
    location.accuracyM !== null
  ) {
    const value = Number(location.accuracyM);
    if (Number.isFinite(value) && value >= 0) {
      // The database keeps whole metres, up to 10 km.
      accuracyM = Math.min(Math.round(value), 10_000);
    } else {
      problems['location.accuracyM'] = 'Précision invalide.';
    }
  }

  let capturedAt: Date | null = null;
  if (point && typeof location.capturedAt === 'string') {
    const date = new Date(location.capturedAt);
    // A device clock can be a little ahead; a date far off is a mistake.
    if (
      Number.isNaN(date.getTime()) ||
      date.getTime() > Date.now() + 5 * 60_000
    ) {
      problems['location.capturedAt'] = 'Date de relevé invalide.';
    } else {
      capturedAt = date;
    }
  }

  const addressHint = optionalText(location.addressHint);
  if (addressHint && addressHint.length > 200) {
    problems['location.addressHint'] =
      "L'indication compte au plus 200 caractères.";
  }

  const served = Array.isArray(location.servedCommuneIds)
    ? location.servedCommuneIds
    : [];
  const validServed = served.filter(
    (id): id is string => typeof id === 'string' && UUID.test(id),
  );
  if (validServed.length !== served.length) {
    problems['location.servedCommuneIds'] = 'Communes desservies invalides.';
  }
  // A commune ticked twice counts once.
  const servedCommuneIds = [...new Set(validServed)];

  // The rules of the three types (database constraint location_type_rules).
  if (type === 'FIXED' && !hasPoint) {
    problems['location.point'] =
      'Relevez la position devant votre activité, ou placez-la sur la carte.';
  }
  if (type === 'MOBILE') {
    if (hasPoint) {
      problems['location.point'] =
        "Une activité mobile n'a pas d'adresse fixe : pas de position.";
    }
    if (servedCommuneIds.length === 0) {
      problems['location.servedCommuneIds'] =
        'Choisissez au moins une commune où vous intervenez.';
    }
  } else if (servedCommuneIds.length > 0) {
    problems['location.servedCommuneIds'] =
      'Les communes desservies concernent les activités mobiles.';
  }

  return {
    type: type as LocationType,
    communeId: communeId as string,
    point,
    source,
    accuracyM,
    capturedAt,
    addressHint,
    servedCommuneIds,
  };
}

/** A new place for an existing listing: body { location }. */
export function readListingLocation(body: unknown): DraftLocationInput {
  const problems: Record<string, string> = {};
  const location = readLocation(record(body).location, problems);
  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return location;
}

export function readDraftListing(body: unknown): DraftListingInput {
  const raw = record(body);
  const problems: Record<string, string> = {};

  const entityType = ENTITY_TYPES.find((value) => value === raw.entityType);
  if (!entityType) {
    problems.entityType = 'Choisissez une activité ou un lieu communautaire.';
  }

  const details = readDetails(raw, problems);

  const location = readLocation(raw.location, problems);

  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return {
    entityType: entityType as EntityType,
    ...details,
    location,
  };
}

export interface ListingServiceInput {
  serviceId: string;
  /** What the listing adds to the catalogue's name (ADR-006, ADR-024). */
  details: string | null;
}

/** The whole list of services of a listing: body { services }. */
export function readListingServices(body: unknown): ListingServiceInput[] {
  const raw = record(body).services;
  const problems: Record<string, string> = {};
  if (!Array.isArray(raw)) {
    throw new InvalidInputError({ services: 'Liste de services attendue.' });
  }
  if (raw.length > MAX_SERVICES_PER_LISTING) {
    problems.services = `Choisissez au plus ${MAX_SERVICES_PER_LISTING} services.`;
  }
  const seen = new Set<string>();
  const services: ListingServiceInput[] = [];
  raw.forEach((item, index) => {
    const entry = record(item);
    const serviceId =
      typeof entry.serviceId === 'string' && UUID.test(entry.serviceId)
        ? entry.serviceId
        : null;
    if (!serviceId || seen.has(serviceId)) {
      problems[`services.${index}`] = 'Service invalide ou en double.';
      return;
    }
    seen.add(serviceId);
    const details = optionalText(entry.details);
    if (details && details.length > MAX_SERVICE_DETAILS_LENGTH) {
      problems[`services.${index}`] =
        `Les précisions comptent au plus ${MAX_SERVICE_DETAILS_LENGTH} caractères.`;
    }
    services.push({ serviceId, details });
  });
  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return services;
}
