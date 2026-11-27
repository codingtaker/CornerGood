# CornerGood

Geolocated discovery platform for small businesses, independent professionals and community places in Grand Lomé, Togo. Academic project (mémoire) and working prototype.

## Repository layout

| Path | Content |
|---|---|
| `apps/api` | REST API — NestJS, TypeScript, PostgreSQL + PostGIS |
| `apps/web` | Progressive Web App — Next.js, TypeScript, Tailwind CSS |
| `docker-compose.yml` | Local PostgreSQL + PostGIS database |

The two applications live in one repository and share a single `package-lock.json` (npm workspaces). They are deployed separately.

## Requirements

- Node.js 22 (see `.nvmrc`)
- Docker Desktop, for the local database

## First start

```bash
cp .env.example .env                       # then set the two passwords (see "Database roles")
cp apps/web/.env.example apps/web/.env.local
npm install
npm run db:up                              # starts PostgreSQL + PostGIS on localhost:$DB_PORT (default 5432)
npm run db:migrate                         # creates the tables and the API role
npm run db:app-role                        # lets the API role sign in with the password of DATABASE_URL
npm run db:seed                            # loads the 13 communes and the initial categories
npm run dev:api                            # http://localhost:3001/api/v1/health
npm run dev:web                            # http://localhost:3000
```

`GET /api/v1/health` answers `{"status":"ok","database":"ok"}` when the database and PostGIS answer, and `503` otherwise. It does not give the PostGIS version: the route is public.

## Database roles

The API never connects as the owner of the database. Two connections are configured in `.env`:

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | `cornergood_app`: reads and writes rows only, table by table (migration `0003`) | the API, `admin:create`, `admin:recover`, `geo:boundaries` |
| `DATABASE_OWNER_URL` | the owner (`POSTGRES_USER`) | `db:migrate`, `db:seed`, `db:app-role` |

`cornergood_app` cannot change the schema, truncate a table, disable a trigger, delete accounts, listings or categories, modify the territory, or touch the moderation log except to add to it. Migration `0003` creates it without a password; `npm run db:app-role` gives it the password written in `DATABASE_URL` (16 characters or more), so that password is stored only in `.env` or in the host's secrets. A new table needs its grant in its migration: a database test fails otherwise.

The API refuses to start in production when `DATABASE_URL` connects with administrative rights, and logs a warning elsewhere.

## Accounts and sessions

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `POST /auth/register` | public | Creates a **professional** account (the role cannot be chosen) and signs it in |
| `POST /auth/login` | public | Signs in with phone and password; one message for every failure |
| `POST /auth/logout` | public | Closes the session |
| `GET /auth/me` | session | The signed-in user |
| `DELETE /auth/me` | session + password | Deletes the account: personal data erased (see below) |
| `GET /pro/listings`, `GET /pro/listings/:id` | session | The professional's own listings; the exact point is shown to the owner only (404 for anyone else) |
| `POST /pro/listings` | session | Creates a draft listing with its location (see *Listings* below) |
| `PATCH /pro/listings/:id` | owner | Replaces name, category, description, phone, WhatsApp, email and opening hours of a draft; a rejected listing becomes a draft again (`409` in any other status) |
| `PUT /pro/listings/:id/services` | owner | Replaces the services of a draft (see *Services, opening hours and email* below) |
| `PUT /pro/listings/:id/location` | owner | Replaces the place of a draft (body `{ location }`, the same as at creation, same checks): type, commune, point, landmark, served communes; a rejected listing becomes a draft again (`409` in any other status) |
| `POST /pro/listings/:id/submit` | owner | `DRAFT` → `PENDING` (see *Submission* below) |
| `GET /admin/…` | session, role `MODERATOR` or `ADMIN` | Moderation; `403` for a professional (see *Back-office* below) |

- Sessions live on the server (`sessions` table, ADR-021). The browser holds a random token in the `cg_session` cookie: `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`. The database stores only its SHA-256. A session lasts 30 days; signing out, deactivating the account or expiry closes it. Signing in again on a device closes the session its cookie held, and an account keeps at most 10 open sessions (the oldest are closed first). Every hour, each API instance deletes expired sessions, stale sign-in counters and SMS codes expired for a day (`MaintenanceService`).
- **Deleting an account** (`DELETE /auth/me`, page `/pro/compte`), confirmed by the password; wrong passwords are counted like sign-in failures. The row of a user cannot be deleted, since listings and the moderation log refer to it and the log is evidence. So the account keeps its row, emptied of personal data (migration `0006`): name "Compte supprimé", no phone, no email, an unusable password, inactive, `deleted_at` set; a constraint makes the database refuse a "deleted" account that keeps any of these. Its sessions, SMS codes and sign-in counters are deleted, and its listings archived, each with a line in the moderation log. The number can then open a new account. The only active administrator cannot delete their account.
- Phone numbers are stored in international format; `90 12 34 56` is read as `+22890123456`.
- **Sign-in limits** (table `auth_throttle`, shared by every API instance). Checked before the password, so a blocked client costs no hashing; the answer is `429` with `Retry-After` and "Trop de tentatives. Réessayez dans N minutes."

  | Key | Allowed | Then |
  |---|---|---|
  | Phone number (account or not) | 5 failures in 24 h | blocked 1, 2, 4… minutes, up to 1 h; a successful sign-in clears it |
  | Address, sign-in | 30 failures in 1 h | blocked 1, 2, 4… minutes, up to 30 min |
  | Address, sign-up | 10 attempts in 1 h | blocked 5, 10, 20… minutes, up to 1 h |

  The address limits are generous because mobile operators put many customers behind one address. IPv6 addresses count by `/64` network.
- **Requests from another site** (`apps/api/src/security/same-origin-json.ts`). Every `POST`, `PUT`, `PATCH` or `DELETE` must send its body as JSON (`415` otherwise: an HTML form cannot; the photo upload is the one exception and requires the `Origin`), and a browser request must come from `WEB_ORIGIN` (`403` when its `Origin` is another site or `Sec-Fetch-Site` says `cross-site`). This stops a third-party page from signing a visitor into another account (login CSRF) or acting in their name. Requests without these headers do not come from a browser and carry no visitor's cookies.
- **Security headers.** The API (`apps/api/src/security/security-headers.ts`) sends `nosniff`, `X-Frame-Options: DENY`, a CSP that allows nothing (`default-src 'none'; frame-ancestors 'none'`), `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, plus HSTS in production, and no `X-Powered-By`. The web app (`apps/web/src/lib/security-headers.ts`, applied in `next.config.ts`) sends a CSP with `frame-ancestors 'none'` (no page can be shown in another site's frame), sources limited to its own origin, `nosniff`, `Permissions-Policy` (position and camera for this site only), and HSTS and `upgrade-insecure-requests` in production. Its CSP keeps `'unsafe-inline'` for scripts, the Next.js variant without nonces, so pages stay static and cacheable; nonces are possible later at the cost of rendering every page on each request. The only other host is the map tile server (`NEXT_PUBLIC_MAP_TILES_URL`), in `img-src` and `connect-src`.
- **Codes by SMS** (table `otp_codes`). `POST /auth/otp` sends a 6-digit code to a Togolese number (`+228` only), for one of two purposes:
  - `LOGIN_UNLOCK`: a number blocked after too many failures signs in with its password **and** the code, without waiting; whoever only knows the number can no longer lock its owner out;
  - `PASSWORD_RESET`: `POST /auth/password-reset` with the code sets a new password, closes every other session and signs in.

  A code is valid 10 minutes, for 5 tries, once; a new code replaces the previous one. Only an HMAC of the code is stored, keyed with `OTP_SECRET`. The answer to `/auth/otp` is the same whether the number has an account or not, and does not wait for the SMS. Requests are limited, since every SMS costs money: one per number, then 1, 2, 4… minutes before the next, up to 1 h; 10 per address and per hour. Wrong codes are counted per address too.
- **Code given by an administrator** (ADR-037, beside the SMS). For a professional who cannot receive the SMS, the administrator checks who is calling, then creates a `PASSWORD_RESET` code with `POST /admin/password-reset-codes` (body `phone`, administrator only) or from `/admin`. The code is shown once and is valid 1 hour; the person enters it on `/mot-de-passe-oublie` ("J'ai déjà un code"). Only active professional accounts are served: staff accounts use `admin:recover`. The API logs who issued a code for which number, never the code.
- **`SMS_PROVIDER`** chooses who sends the SMS (`apps/api/src/sms/sms.module.ts`). Only `console` exists for now: it writes the SMS, code included, in the API logs, and the API refuses to start with it in production. The real provider is still to be chosen; adding one means a class implementing `SmsSender` and its name in `SMS_PROVIDERS`.
- **`TRUST_PROXY`** names the proxies allowed to give the visitor's address (`X-Forwarded-For`): `loopback` by default, for the web app on the same machine. In production it must list **every** proxy in front of the API (the web app's server and any load balancer, as addresses or subnets); otherwise all visitors share the proxy's address and one person could block everyone. `true` is refused, since anyone could then forge their address.
- The browser calls the API through the web app (`/api/v1/*` is forwarded to `API_URL`, see `apps/web/next.config.ts`), so the cookie belongs to the web app's own origin. The web app's `proxy.ts` sends visitors without a cookie from `/pro` and `/admin` to `/connexion`; the pages then ask the API who is signed in. The API decides access in every case.

## Listings and locations (S3)

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `GET /communes` | public | The 13 communes, to choose one from a list (ADR-044) |
| `GET /communes/locate?lat=&lng=` | public, not cached | The commune whose official boundary covers the point (`inside`); else the nearest within 50 m, for a GPS fix just outside Grand Lomé (`nearby`); else `null` |
| `GET /categories?entityType=BUSINESS\|COMMUNITY` | public | Active categories of one kind of listing |
| `GET /services?category=reparation` | public | Active services of one category, by name |

A listing is created as a **draft** from `/pro/fiches/nouvelle`, in three ways:

| Type | Position | Shown to the public |
|---|---|---|
| `FIXED`: "Je suis devant mon activité" | required: the phone's GPS position with its accuracy, or a pin placed by hand | exact point |
| `HOME_BASED`: "Je travaille à domicile" | optional | never the exact point: about 550 m (ADR-046, `public_locations`) |
| `MOBILE`: "Je me déplace" | none | the communes it serves |

A fixed place is always checked on a map before it is saved (ADR-041): MapLibre, loaded only there, with the tiles of `NEXT_PUBLIC_MAP_TILES_URL` (OpenStreetMap's by default: fine for a prototype, not for heavy traffic) and the commune borders. The pin can be dragged, or placed without any GPS; it is then saved as `MANUAL_PIN`, without an accuracy. The tile server sees the area displayed, so no map is shown for a home.

The commune found from the position is only proposed: the person confirms or changes it in the list (ADR-044). The API refuses a point more than 1 km from Grand Lomé, a category of the other kind of listing, and more than 20 unpublished listings per account. Phone and description may wait: they are required at submission (ADR-045).

## Submission (S4)

`POST /pro/listings/:id/submit` first checks the listing and answers `422 SUBMISSION_INCOMPLETE` with one message per missing `field`: a description; for an activity, a phone **or** WhatsApp number (a community place may have none, ADR-045); a usable location; a category still active. The change to `PENDING` and the `SUBMIT` line of the log are one transaction, under a lock: a double tap submits once. Under review, neither the listing nor its photos can change. The page `/pro/fiches/:id` saves what is on the screen before it sends it.

## Photos (S4)

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `POST /pro/listings/:id/media` | owner | Adds one photo (`multipart/form-data`, field `file`): JPEG, PNG or WebP, 5 MB and 6 photos per listing at most (ADR-040) |
| `GET /pro/listings/:id/media`, `GET …/media/:mediaId` | owner | The photos and their status; one photo, never cached |
| `DELETE /pro/listings/:id/media/:mediaId` | owner | Deletes a photo and its file; the next one becomes the cover |

- **No position leaves with a photo** (ADR-041). The phone draws the photo again (1280 px, WebP), so its EXIF is never sent; the server decodes and encodes it again with `sharp`, which keeps the pixels only, and checks the result before storing it.
- The type is read from the content, not from the name. An image that decodes to more than 25 million pixels is refused.
- Every photo starts `PENDING`; **no public route serves photos yet**. Photos change only while the listing is a draft or rejected (`409` otherwise).
- Files are kept behind the `MediaStorage` interface (ADR-029): the folder `MEDIA_DIR` in the prototype (`var/media`, ignored by Git), to back up with the database.
- 20 uploads per account and per hour, then `429`. Deleting an account deletes the photos of all its listings, files included.
- This route is the only one that accepts something else than JSON; it then requires the `Origin` of the web app.

## Back-office (S4)

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `GET /admin/moderation` | moderator, administrator | Listings `PENDING`, the oldest submission first, with the number of photos to check |
| `GET /admin/listings/:id` | moderator, administrator | Everything needed to decide: private data and exact point, owner, photos, moderation log |
| `POST /admin/listings/:id/approve` | **administrator** | `PENDING` → `PUBLISHED`, sets `published_at` |
| `POST /admin/listings/:id/reject` | **administrator** | `PENDING` → `REJECTED`; body `reason` (1 to 500 characters), else `422 REASON_REQUIRED` |
| `GET /admin/media/:id` | moderator, administrator | One photo, never cached |
| `POST /admin/media/:id/approve`, `…/reject` | moderator, administrator | A photo becomes `APPROVED`, or `REJECTED` with its `reason` |

- Only the administrator publishes or rejects a listing (ADR-010); a moderator checks the photos (ADR-039).
- Each decision changes the status and writes its line in `moderation_log` in one transaction, under a row lock: a second decision, or a late one, answers `409 INVALID_STATE`.
- Photo decisions are logged too (`APPROVE_MEDIA`, `REJECT_MEDIA`, migration 0008). The line keeps the id of the photo without a foreign key, so the decision stays after the professional deletes a refused photo.
- Photos are decided only on a listing sent for validation or published: a draft is the professional's work in progress.
- The professional reads the reason on `/pro/fiches/:id` (`rejection` in `GET /pro/listings/:id`, `rejectionReason` for a photo) until the listing is sent again, corrects it (details, photos, or the place with "Modifier le lieu"), and sends it again.
- Screens: `/admin/moderation` (queue) and `/admin/fiches/:id` (decision page: "Publier", "Rejeter avec motif", photos one by one, history).

## Public page of a listing

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `GET /listings/:slug` | public, cached 60 s | A published listing as anyone sees it (ADR-060); `404` for any other status, even when the address is known |
| `GET /listings/:slug/photos/:id` | public, cached 60 s | An approved photo of a published listing; `404` for a photo pending or refused |

- Read from the view `public_locations` only (ADR-046): the exact point of a fixed place, the centre of a sector of about 550 m for a home, no point for a mobile activity. Never the owner.
- Only approved photos (ADR-019); a listing may be published while some photos await a decision, which then stay hidden (ADR-054).
- 60 seconds of cache (ADR-022): a suspended listing disappears quickly. This replaces the API's `no-store` on these two routes only.
- The web page is `/fiches/:slug`, the address to share: "Appeler" (`tel:`), "WhatsApp" (`wa.me`, with a first message), a map with the pin or the sector, "Itinéraire" for a fixed place. The owner reaches it from `/pro/fiches/:id` once published, the back-office from `/admin/fiches/:id`.

## Services, opening hours and email

- **Catalogue** (ADR-006, ADR-024): `npm run db:seed` creates a **provisional** starter catalogue, 91 services, 2 to 8 per category (`apps/api/src/database/seed-data/services.ts`), to check against the field survey. Like categories, a service is only created when missing, so the administrators' later edits stay.
- **Services of a listing**: `PUT /pro/listings/:id/services` with `{ services: [{ serviceId, details? }] }` replaces the whole list. Rules:
  - only active services of the listing's own category;
  - 15 services at most, each once;
  - `details` of 300 characters at most ("écrans Tecno et Infinix").

  Changing the category drops the services of the old one. A service missing from the catalogue goes in the description.
- **Opening hours**, in `PATCH /pro/listings/:id`. For each day: closed (`[]`) or one or two ranges, as in `{ "mon": [["08:00","12:00"],["14:00","18:00"]], "sun": [] }`. A day left out is not said. Times are Lomé time, `"24:00"` for midnight; ranges must end after they start and not overlap.
- **Email**: optional, stored in lowercase.
- All three show on the public page (`/fiches/:slug`) and on the owner's page. Editing goes through the same rules as the other details: draft or rejected only, and a rejected listing becomes a draft again.

## Reports

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `POST /listings/:slug/reports` | public, 5 per hour per address | Body `reason` (`WRONG_INFO`, `CLOSED`, `WRONG_LOCATION`, `DUPLICATE`, `INAPPROPRIATE`, `OTHER`), `description` (1 to 1000 characters), `reporterContact?` (120 at most). `201 { id }`; `404` unless the listing is published |
| `GET /admin/reports?status=` | moderator, administrator | Open reports first, then in review, then closed |
| `GET /admin/reports/:id` | moderator, administrator | The report with the private contact, and the listing it is about |
| `POST /admin/reports/:id/take` | moderator, administrator | `OPEN` → `IN_REVIEW`, assigned to the caller |
| `POST /admin/reports/:id/resolve`, `…/dismiss` | moderator, administrator | → `RESOLVED` or `DISMISSED`; body `note` (1 to 1000 characters), else `422 NOTE_REQUIRED` |

- Anyone may report, without an account (ADR-017). The contact is optional and never public.
- A report on a `VERIFIED` listing makes it `VERIFICATION_PENDING` in the same transaction (ADR-018).
- Handling a report never changes the listing: a correction or a suspension goes through its own action.
- Every change of a report is made under a row lock: a second take or close answers `409 INVALID_STATE`. Migration 0009 adds `resolution_note`, required to close a report, and requires a handler once it is taken.
- Screens: "Signaler une erreur sur cette fiche" on `/fiches/:slug`; `/admin/signalements` (filters by status) and `/admin/signalements/:id` ("Prendre en charge", "Résolu", "Classé").

## Search and home page

| Route (`/api/v1`) | Access | Effect |
|---|---|---|
| `GET /search` | public, 60 per minute per address, cached 60 s | Published listings, ranked; `{ data, meta: { page, limit, total } }` |

- **Parameters** (contract §4.1), at least one besides the page, else `400`:
  - `q`: 2 to 80 characters;
  - `category`, `service`, `commune`: slugs;
  - `entityType`;
  - `lat` and `lng` together, with `radius` (100 to 20000 m, default 3000);
  - `bbox` = `minLng,minLat,maxLng,maxLat`;
  - `page` (1 to 50) and `limit` (1 to 50, default 20).
- **Words**: each word of `q` must be in the name, the category or an active service of the listing, without accents or case ("ecran" finds "Remplacement d'écran"). Short words such as "de" or "la" are dropped. Migration 0010 adds `search_fold()`, the SQL side of this folding.
- **Places**: a fixed place is found within the radius of its point; a home by its sector centre or its commune; a mobile activity by the communes it serves (RM-023). `bbox` keeps only listings with a point.
- **Score** (ADR-015, ADR-064): `0.40 × category + 0.30 × service + 0.20 × proximity + 0.10 × completeness`, computed in SQL before paging; ties go by `id`. Proximity is `1 − distance / radius`, or `0.5` for a mobile activity serving the place. Completeness counts a quarter each for an approved photo, opening hours, a service and a second contact. The weights are in `apps/api/src/search/search.service.ts`.
- **What is read**: only what the public may see: `public_locations`, active services, approved photos. With a position, the answer is cached `private`, not `public`.
- **Screens**:
  - `/` (home): "Que cherchez-vous ?", activity, commune, "Autour de moi", then the categories to browse;
  - `/recherche`: the same form and the results, 20 per page;
  - `/recherche?…&vue=carte`: the same search on a map. It asks `/search` with the visible area (`bbox`, the best 50) each time the map stops moving, without the position or the page. A fixed place is a dot, a home its sector of about 550 m, and tapping one opens its card with "Voir la fiche". Mobile activities have no point and stay in the list. The map opens only when chosen: the tile server sees the area displayed.
- **Position**: rounded to about 110 m in the address bar.
- **Who asks the API**: the browser fetches the results through the `/api/v1` rewrite, so the API limits each visitor, not the web server.

## Useful commands

| Command | Effect |
|---|---|
| `npm run lint` | Lint both applications |
| `npm test` | Unit tests: API (Jest) and web app (Vitest: `proxy.ts`, `lib/`, the sign-in and account-deletion forms) |
| `npm run test:e2e` | API end-to-end tests (no database needed yet) |
| `npm run test:db` | Schema tests against a real database: set `TEST_DATABASE_URL` to a **dedicated, empty** database, because its `public` schema is wiped. The tests refuse to run unless the database name ends in `_test` and differs from `DATABASE_URL`. Skipped without `TEST_DATABASE_URL`, except in CI where it fails |
| `npm run build` | Production build of both applications |
| `npm run db:migrate` | Apply pending migrations (`apps/api/src/database/migrations`) |
| `npm run db:migrate:down` | Revert the last migration (development only: refused when `NODE_ENV=production`; in production, fix with a new migration) |
| `npm run db:app-role` | Let the API role sign in with the password of `DATABASE_URL`; run again to change it |
| `npm run db:seed` | Load reference data; safe to run several times. Communes are updated; categories are only added when missing, so edits made by administrators are kept |
| `npm run geo:boundaries -- <pdf>` | Regenerate the commune boundaries from the ministry's GeoPDF (see *Data sources*); needs `DATABASE_URL` for PostGIS |
| `npm run admin:create` | Create the first administrator (see below); refused once an administrator exists |
| `npm run admin:recover` | Restore the administrator account when no administrator can sign in (see below) |
| `npm run db:down` | Stop the database (data is kept in a Docker volume) |

To create the test database once Docker is running:

```bash
docker compose exec db createdb -U cornergood cornergood_test
# then, in .env or your shell:
# TEST_DATABASE_URL=postgres://cornergood:<owner password>@localhost:$DB_PORT/cornergood_test
```

The tests connect as the owner, to rebuild the schema, and run the API itself as `cornergood_app`.

## First administrator

Public sign-up only creates professional accounts, and only an administrator can create another one (ADR-047). The first administrator is created once, from the command line, after `npm run db:migrate`:

1. Set `ADMIN_FULL_NAME`, `ADMIN_PHONE` (written as at sign-up: `90 12 34 56` or `+22890123456`) and optionally `ADMIN_EMAIL`, in `.env` or in your shell.
2. Run `npm run admin:create` in an interactive terminal, and type the password twice when asked (12 characters or more). It is not shown on screen, and is stored only as a scrypt hash: it never goes into a file or the shell history.

The command refuses to run when `ADMIN_PASSWORD` is set, when an administrator already exists, or when the phone or email belongs to another account.

### When no administrator can sign in any more

If the only administrator was deactivated or has forgotten their password, restore that account from the server instead of editing the database by hand:

1. Set `ADMIN_PHONE` to the phone of the administrator account, in `.env` or in your shell.
2. Run `npm run admin:recover` in an interactive terminal and type the new password twice.

The account is reactivated, gets the new password, and all its sessions are closed. The command refuses when another administrator is still active (that administrator does it from the application), when the account is not an administrator, or when `ADMIN_PASSWORD` is set. It needs access to the server and its database, so keep that access as restricted as the database itself.

## Database conventions

- Migrations are plain SQL inside Kysely migration files, numbered `0001_…`, `0002_…`. A merged migration is never edited: a change goes into a new migration.
- Closed lists are `text` columns with a `CHECK`, not PostgreSQL `ENUM` types, so values can be changed later.
- Single-row business rules (location types, a reason for every rejection, one primary location, one pending revision) are enforced by constraints as well as by the API.
- `moderation_log` is append-only: a trigger rejects any update or deletion, and the API role is only granted `SELECT` and `INSERT` on it.
- Coordinates are `geography(Point, 4326)`; remember that `ST_MakePoint` takes the **longitude first**.
- **Public pages read locations from the view `public_locations`, never from `locations`** (ADR-046, migration `0007`). The view only shows published listings and never the exact point of an `APPROXIMATE` location, such as a home: that point is snapped to a grid of about 550 m. The table keeps the exact point for the owner and the moderators.

## Rules

- Never commit `.env` files: this repository is public.
- Code, identifiers and comments in English; product text in French.
- Design decisions are recorded in the project's decision register (ADR-001 to ADR-047), kept outside this repository. The code cites them by number.

## Data sources

| Data | Source | Licence |
|---|---|---|
| Names of the 13 communes | Law n° 2017-008 of 29 June 2017 creating the communes | Public |
| Boundaries of the 13 communes | MATDCL, map *Communes du Grand Lomé* (25 April 2019), GeoPDF distributed by [pS-Eau](https://www.pseau.org/outils/ouvrages/tg_matdcl_communes_du_grand_lome_2019.pdf), layer `Limites_Commune__GrandLome` | Official publication, no licence stated: credit the ministry |

The boundaries are the vector polygons of the ministry's GeoPDF, converted to WGS 84 by `npm run geo:boundaries -- <path to the PDF>` (see `apps/api/src/database/geodata`). The web app draws a lighter copy, `apps/web/public/data/communes.geojson` (48 KB, 13 KB gzipped, against 137 KB), made by `npm run geo:web` with a topological simplification: neighbours keep exactly the same border, and borders move by 23 m at most. Locating a point stays on the server, on the full boundaries. The script refuses any file other than the reviewed edition (checked by SHA-256). The PDF names the communes without numbering them: the number of each commune was checked against citypopulation.de for all 13 communes and is documented in `seed-data/territory.ts`; the decree that sets the chief towns remains the primary source to find. **Any map that shows these boundaries must credit "MATDCL, 2019".**

## Licence

MIT (code). Data keeps the licence of its source, listed above.
