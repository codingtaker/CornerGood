import type { ColumnType, Generated } from 'kysely';

/*
 * TypeScript view of the schema created by the migrations, used by Kysely to
 * type-check queries. Keep it in sync with every new migration; the database
 * integration tests fail when a column listed here is missing.
 *
 * Geography columns are returned by PostgreSQL as an opaque binary string.
 * Queries convert them explicitly (ST_X, ST_Y, ST_AsGeoJSON), so they are typed
 * as `string` and never read directly.
 */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type UpdatedAt = ColumnType<Date, never, never>;
type Geography = ColumnType<string, string, string>;
type Json = ColumnType<unknown, string, string>;

export type EntityType = 'BUSINESS' | 'COMMUNITY';
export type UserRole = 'PROFESSIONAL' | 'MODERATOR' | 'ADMIN';
export type PublicationStatus =
  'DRAFT' | 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'SUSPENDED' | 'ARCHIVED';
export type VerificationStatus =
  'UNVERIFIED' | 'VERIFIED' | 'VERIFICATION_PENDING';
export type LocationType = 'FIXED' | 'MOBILE' | 'HOME_BASED';
export type LocationVisibility = 'PUBLIC' | 'APPROXIMATE';
export type PositionSource = 'DEVICE_GPS' | 'MANUAL_PIN' | 'ADMIN';
export type MediaStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RevisionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ModerationAction =
  | 'SUBMIT'
  | 'REQUEST_CHANGES'
  | 'ESCALATE'
  | 'APPROVE'
  | 'REJECT'
  | 'SUSPEND'
  | 'REINSTATE'
  | 'ARCHIVE'
  | 'EDIT'
  | 'VERIFY'
  | 'UNVERIFY'
  | 'APPROVE_MEDIA'
  | 'REJECT_MEDIA';
export type ReportReason =
  | 'WRONG_INFO'
  | 'CLOSED'
  | 'WRONG_LOCATION'
  | 'DUPLICATE'
  | 'INAPPROPRIATE'
  | 'OTHER';
export type ReportStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';

export interface RegionsTable {
  id: Generated<string>;
  name: string;
  slug: string;
}

export interface PrefecturesTable {
  id: Generated<string>;
  region_id: string;
  name: string;
  slug: string;
}

export interface CommunesTable {
  id: Generated<string>;
  prefecture_id: string;
  name: string;
  slug: string;
  boundary: Geography | null;
  centroid: Geography | null;
  centroid_is_approximate: Generated<boolean>;
}

export interface UsersTable {
  id: Generated<string>;
  full_name: string;
  /** NULL only for a deleted account (migration 0006). */
  phone: string | null;
  email: string | null;
  password_hash: string;
  role: UserRole;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  last_login_at: Timestamp | null;
  deleted_at: Timestamp | null;
}

export interface SessionsTable {
  /** SHA-256 of the cookie value: the token itself is never stored. */
  token_hash: ColumnType<Buffer, Buffer, never>;
  user_id: string;
  created_at: CreatedAt;
  expires_at: Timestamp;
}

export interface AuthThrottleTable {
  key: string;
  failures: number;
  window_started_at: Timestamp;
  blocked_until: Timestamp | null;
  updated_at: Generated<Date>;
}

export type OtpPurpose = 'LOGIN_UNLOCK' | 'PASSWORD_RESET';

export interface OtpCodesTable {
  id: Generated<string>;
  user_id: string;
  purpose: OtpPurpose;
  code_hash: ColumnType<Buffer, Buffer, never>;
  attempts: Generated<number>;
  created_at: CreatedAt;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
}

export interface CategoriesTable {
  id: Generated<string>;
  parent_id: string | null;
  name: string;
  slug: string;
  applicable_to: EntityType | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
}

export interface ServicesTable {
  id: Generated<string>;
  category_id: string;
  name: string;
  slug: string;
  is_active: Generated<boolean>;
}

export interface EstablishmentsTable {
  id: Generated<string>;
  owner_id: string | null;
  created_by_id: string;
  category_id: string;
  entity_type: EntityType;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  opening_hours: Json | null;
  publication_status: Generated<PublicationStatus>;
  verification_status: Generated<VerificationStatus>;
  published_at: Timestamp | null;
  last_verified_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BusinessProfilesTable {
  establishment_id: string;
  registration_number: string | null;
  started_year: number | null;
}

export interface CommunityProfilesTable {
  establishment_id: string;
  managing_body: string | null;
  access_conditions: string | null;
}

export interface LocationsTable {
  id: Generated<string>;
  establishment_id: string;
  commune_id: string;
  location_type: LocationType;
  visibility: LocationVisibility;
  geom: Geography | null;
  address_hint: string | null;
  is_primary: Generated<boolean>;
  position_source: PositionSource | null;
  position_accuracy_m: number | null;
  position_captured_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface LocationServedCommunesTable {
  location_id: string;
  commune_id: string;
}

export interface EstablishmentServicesTable {
  establishment_id: string;
  service_id: string;
  details: string | null;
}

export interface MediaTable {
  id: Generated<string>;
  establishment_id: string;
  storage_key: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  size_bytes: number;
  status: Generated<MediaStatus>;
  display_order: Generated<number>;
  is_cover: Generated<boolean>;
  /** Required when REJECTED, NULL otherwise (migration 0008). */
  rejection_reason: string | null;
  captured_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface EstablishmentRevisionsTable {
  id: Generated<string>;
  establishment_id: string;
  submitted_by_id: string;
  reviewed_by_id: string | null;
  proposed_changes: Json;
  status: Generated<RevisionStatus>;
  rejection_reason: string | null;
  created_at: CreatedAt;
  decided_at: Timestamp | null;
}

export interface ModerationLogTable {
  id: Generated<string>;
  establishment_id: string;
  revision_id: string | null;
  /** The photo of an APPROVE_MEDIA or REJECT_MEDIA line, kept after its deletion (0008). */
  media_id: string | null;
  actor_id: string;
  action: ModerationAction;
  from_status: PublicationStatus | null;
  to_status: PublicationStatus | null;
  reason: string | null;
  created_at: CreatedAt;
}

export interface ReportsTable {
  id: Generated<string>;
  establishment_id: string;
  reporter_id: string | null;
  handled_by_id: string | null;
  reason: ReportReason;
  description: string;
  reporter_contact: string | null;
  status: Generated<ReportStatus>;
  created_at: CreatedAt;
  resolved_at: Timestamp | null;
  /** Required to close a report (migration 0009). */
  resolution_note: string | null;
}

/** View: the only source of locations for public pages (ADR-046, 0007). */
export interface PublicLocationsView {
  id: string;
  establishment_id: string;
  commune_id: string;
  location_type: LocationType;
  visibility: LocationVisibility;
  address_hint: string | null;
  is_primary: boolean;
  /** Snapped to about 550 m when the location is APPROXIMATE. */
  geom: Geography | null;
}

export interface Database {
  regions: RegionsTable;
  prefectures: PrefecturesTable;
  communes: CommunesTable;
  users: UsersTable;
  sessions: SessionsTable;
  categories: CategoriesTable;
  services: ServicesTable;
  establishments: EstablishmentsTable;
  business_profiles: BusinessProfilesTable;
  community_profiles: CommunityProfilesTable;
  locations: LocationsTable;
  location_served_communes: LocationServedCommunesTable;
  establishment_services: EstablishmentServicesTable;
  media: MediaTable;
  establishment_revisions: EstablishmentRevisionsTable;
  moderation_log: ModerationLogTable;
  reports: ReportsTable;
  public_locations: PublicLocationsView;
  auth_throttle: AuthThrottleTable;
  otp_codes: OtpCodesTable;
}
