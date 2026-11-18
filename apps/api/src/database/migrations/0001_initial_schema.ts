import { Kysely, sql } from 'kysely';

/*
 * Initial CornerGood schema (decision register ADR-002 to ADR-019, ADR-041).
 *
 * Conventions:
 * - Closed lists use text + CHECK instead of PostgreSQL ENUM types: a CHECK can be
 *   changed in a later migration, while an ENUM value cannot be removed.
 * - Business rules that involve one row only are enforced here as well as in the
 *   API, so that a bug or a manual SQL edit cannot store an inconsistent listing.
 * - Rules that need several rows (a MOBILE location needs at least one served
 *   commune) are checked by the API at submission time.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE EXTENSION IF NOT EXISTS postgis;

    CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION reject_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
    END;
    $$;

    -- Territory (ADR-007) -------------------------------------------------

    CREATE TABLE regions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      slug text NOT NULL UNIQUE
    );

    CREATE TABLE prefectures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      region_id uuid NOT NULL REFERENCES regions (id) ON DELETE RESTRICT,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      UNIQUE (region_id, name)
    );

    CREATE TABLE communes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      prefecture_id uuid NOT NULL REFERENCES prefectures (id) ON DELETE RESTRICT,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      -- Official boundaries are not available yet (ADR-028).
      boundary geography(MultiPolygon, 4326),
      centroid geography(Point, 4326),
      centroid_is_approximate boolean NOT NULL DEFAULT true,
      UNIQUE (prefecture_id, name)
    );
    CREATE INDEX communes_boundary_gist ON communes USING gist (boundary);

    -- Accounts (ADR-020, ADR-021) -----------------------------------------

    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
      phone text NOT NULL UNIQUE CHECK (phone ~ '^\\+[1-9][0-9]{7,14}$'),
      email text,
      password_hash text NOT NULL,
      role text NOT NULL CHECK (role IN ('PROFESSIONAL', 'MODERATOR', 'ADMIN')),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    );
    -- Two accounts must not share an email, whatever the letter case.
    CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
    CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Catalogue (ADR-006, ADR-024) ----------------------------------------

    CREATE TABLE categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id uuid REFERENCES categories (id) ON DELETE RESTRICT,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      -- NULL means the category applies to both kinds of listing.
      applicable_to text CHECK (applicable_to IN ('BUSINESS', 'COMMUNITY')),
      display_order integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      CHECK (parent_id <> id)
    );
    CREATE INDEX categories_parent_id_idx ON categories (parent_id);

    CREATE TABLE services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE INDEX services_category_id_idx ON services (category_id);

    -- Listings (ADR-003, ADR-008 to ADR-012, ADR-018) ---------------------

    CREATE TABLE establishments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- NULL when an administrator created the listing for someone without an account.
      owner_id uuid REFERENCES users (id) ON DELETE RESTRICT,
      created_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
      category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
      entity_type text NOT NULL CHECK (entity_type IN ('BUSINESS', 'COMMUNITY')),
      name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
      slug text NOT NULL UNIQUE,
      description text CHECK (char_length(description) <= 2000),
      phone text CHECK (phone ~ '^\\+[1-9][0-9]{7,14}$'),
      whatsapp text CHECK (whatsapp ~ '^\\+[1-9][0-9]{7,14}$'),
      email text,
      opening_hours jsonb,
      publication_status text NOT NULL DEFAULT 'DRAFT' CHECK (
        publication_status IN ('DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED')
      ),
      verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (
        verification_status IN ('UNVERIFIED', 'VERIFIED', 'VERIFICATION_PENDING')
      ),
      published_at timestamptz,
      last_verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT published_listing_has_date
        CHECK (publication_status <> 'PUBLISHED' OR published_at IS NOT NULL),
      -- Only a draft (or a draft abandoned into the archive) may lack its contact data.
      CONSTRAINT submitted_listing_is_complete CHECK (
        publication_status IN ('DRAFT', 'ARCHIVED')
        OR (phone IS NOT NULL AND description IS NOT NULL)
      )
    );
    CREATE INDEX establishments_owner_id_idx ON establishments (owner_id);
    CREATE INDEX establishments_created_by_id_idx ON establishments (created_by_id);
    CREATE INDEX establishments_category_id_idx ON establishments (category_id);
    CREATE INDEX establishments_publication_status_idx ON establishments (publication_status);
    CREATE TRIGGER establishments_set_updated_at BEFORE UPDATE ON establishments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE business_profiles (
      establishment_id uuid PRIMARY KEY REFERENCES establishments (id) ON DELETE CASCADE,
      -- Optional: informal activities are welcome.
      registration_number text,
      started_year smallint CHECK (started_year BETWEEN 1900 AND 2100)
    );

    CREATE TABLE community_profiles (
      establishment_id uuid PRIMARY KEY REFERENCES establishments (id) ON DELETE CASCADE,
      managing_body text,
      access_conditions text
    );

    -- Locations (ADR-003 to ADR-005, ADR-041) -----------------------------

    CREATE TABLE locations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      establishment_id uuid NOT NULL REFERENCES establishments (id) ON DELETE CASCADE,
      commune_id uuid NOT NULL REFERENCES communes (id) ON DELETE RESTRICT,
      location_type text NOT NULL CHECK (location_type IN ('FIXED', 'MOBILE', 'HOME_BASED')),
      visibility text NOT NULL CHECK (visibility IN ('PUBLIC', 'APPROXIMATE')),
      geom geography(Point, 4326),
      address_hint text CHECK (char_length(address_hint) <= 200),
      is_primary boolean NOT NULL DEFAULT false,
      position_source text CHECK (position_source IN ('DEVICE_GPS', 'MANUAL_PIN', 'ADMIN')),
      position_accuracy_m integer CHECK (position_accuracy_m BETWEEN 0 AND 10000),
      position_captured_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT location_type_rules CHECK (
        (location_type = 'FIXED' AND geom IS NOT NULL AND visibility = 'PUBLIC')
        OR (location_type = 'MOBILE' AND geom IS NULL AND visibility = 'APPROXIMATE')
        OR location_type = 'HOME_BASED'
      ),
      CONSTRAINT public_location_has_point
        CHECK (visibility = 'APPROXIMATE' OR geom IS NOT NULL),
      CONSTRAINT point_has_source CHECK ((geom IS NULL) = (position_source IS NULL)),
      CONSTRAINT accuracy_needs_point CHECK (
        geom IS NOT NULL OR (position_accuracy_m IS NULL AND position_captured_at IS NULL)
      )
    );
    CREATE UNIQUE INDEX locations_one_primary_per_establishment
      ON locations (establishment_id) WHERE is_primary;
    CREATE INDEX locations_establishment_id_idx ON locations (establishment_id);
    CREATE INDEX locations_commune_id_idx ON locations (commune_id);
    CREATE INDEX locations_geom_gist ON locations USING gist (geom);
    CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE location_served_communes (
      location_id uuid NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
      commune_id uuid NOT NULL REFERENCES communes (id) ON DELETE RESTRICT,
      PRIMARY KEY (location_id, commune_id)
    );
    CREATE INDEX location_served_communes_commune_id_idx
      ON location_served_communes (commune_id);

    CREATE TABLE establishment_services (
      establishment_id uuid NOT NULL REFERENCES establishments (id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES services (id) ON DELETE RESTRICT,
      details text CHECK (char_length(details) <= 300),
      PRIMARY KEY (establishment_id, service_id)
    );
    CREATE INDEX establishment_services_service_id_idx ON establishment_services (service_id);

    -- Photos (ADR-019, ADR-041) -------------------------------------------

    CREATE TABLE media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      establishment_id uuid NOT NULL REFERENCES establishments (id) ON DELETE CASCADE,
      storage_key text NOT NULL UNIQUE,
      mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
      size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
      status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
      display_order integer NOT NULL DEFAULT 0,
      is_cover boolean NOT NULL DEFAULT false,
      captured_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX media_one_cover_per_establishment
      ON media (establishment_id) WHERE is_cover;
    CREATE INDEX media_establishment_id_idx ON media (establishment_id);

    -- Moderation (ADR-008, ADR-011, ADR-017) ------------------------------

    CREATE TABLE establishment_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      establishment_id uuid NOT NULL REFERENCES establishments (id) ON DELETE RESTRICT,
      submitted_by_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
      reviewed_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
      proposed_changes jsonb NOT NULL,
      status text NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
      ),
      rejection_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz,
      -- "IS NOT NULL" is required: a CHECK that evaluates to NULL is accepted.
      CONSTRAINT rejected_revision_has_reason CHECK (
        status <> 'REJECTED'
        OR (rejection_reason IS NOT NULL AND char_length(btrim(rejection_reason)) > 0)
      ),
      CONSTRAINT decided_revision_has_date CHECK ((status = 'PENDING') = (decided_at IS NULL))
    );
    -- One pending revision at a time per listing (ADR-008).
    CREATE UNIQUE INDEX establishment_revisions_one_pending
      ON establishment_revisions (establishment_id) WHERE status = 'PENDING';
    CREATE INDEX establishment_revisions_establishment_id_idx
      ON establishment_revisions (establishment_id);

    CREATE TABLE moderation_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      establishment_id uuid NOT NULL REFERENCES establishments (id) ON DELETE RESTRICT,
      revision_id uuid REFERENCES establishment_revisions (id) ON DELETE RESTRICT,
      actor_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
      action text NOT NULL CHECK (action IN (
        'SUBMIT', 'REQUEST_CHANGES', 'ESCALATE', 'APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE', 'ARCHIVE'
      )),
      from_status text CHECK (from_status IN (
        'DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED'
      )),
      to_status text CHECK (to_status IN (
        'DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED'
      )),
      reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT decision_has_reason CHECK (
        action NOT IN ('REQUEST_CHANGES', 'REJECT', 'SUSPEND')
        OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0)
      )
    );
    CREATE INDEX moderation_log_establishment_idx ON moderation_log (establishment_id, created_at);
    -- The log is evidence of administrative control: it can only grow.
    CREATE TRIGGER moderation_log_append_only BEFORE UPDATE OR DELETE ON moderation_log
      FOR EACH ROW EXECUTE FUNCTION reject_change();
    CREATE TRIGGER moderation_log_no_truncate BEFORE TRUNCATE ON moderation_log
      FOR EACH STATEMENT EXECUTE FUNCTION reject_change();

    CREATE TABLE reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      establishment_id uuid NOT NULL REFERENCES establishments (id) ON DELETE RESTRICT,
      -- NULL when a visitor without an account reports.
      reporter_id uuid REFERENCES users (id) ON DELETE RESTRICT,
      handled_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
      reason text NOT NULL CHECK (reason IN (
        'WRONG_INFO', 'CLOSED', 'WRONG_LOCATION', 'DUPLICATE', 'INAPPROPRIATE', 'OTHER'
      )),
      description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 1000),
      reporter_contact text CHECK (char_length(reporter_contact) <= 120),
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      CONSTRAINT closed_report_has_date
        CHECK ((status IN ('RESOLVED', 'DISMISSED')) = (resolved_at IS NOT NULL))
    );
    CREATE INDEX reports_status_idx ON reports (status);
    CREATE INDEX reports_establishment_id_idx ON reports (establishment_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Tables are dropped in reverse dependency order. The PostGIS extension is kept:
  // other databases objects may rely on it and it costs nothing when unused.
  await sql`
    DROP TABLE IF EXISTS reports;
    DROP TABLE IF EXISTS moderation_log;
    DROP TABLE IF EXISTS establishment_revisions;
    DROP TABLE IF EXISTS media;
    DROP TABLE IF EXISTS establishment_services;
    DROP TABLE IF EXISTS location_served_communes;
    DROP TABLE IF EXISTS locations;
    DROP TABLE IF EXISTS community_profiles;
    DROP TABLE IF EXISTS business_profiles;
    DROP TABLE IF EXISTS establishments;
    DROP TABLE IF EXISTS services;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS communes;
    DROP TABLE IF EXISTS prefectures;
    DROP TABLE IF EXISTS regions;
    DROP FUNCTION IF EXISTS reject_change();
    DROP FUNCTION IF EXISTS set_updated_at();
  `.execute(db);
}
