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
| `GET /pro/…` | session | Professional space |
| `GET /admin/…` | session, role `MODERATOR` or `ADMIN` | Moderation; `403` for a professional |

- Sessions live on the server (`sessions` table, ADR-021). The browser holds a random token in the `cg_session` cookie: `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`. The database stores only its SHA-256. A session lasts 30 days; signing out, deactivating the account or expiry closes it. Signing in again on a device closes the session its cookie held, and an account keeps at most 10 open sessions (the oldest are closed first). Every hour, each API instance deletes expired sessions, stale sign-in counters and SMS codes expired for a day (`MaintenanceService`).
- Phone numbers are stored in international format; `90 12 34 56` is read as `+22890123456`.
- **Sign-in limits** (table `auth_throttle`, shared by every API instance). Checked before the password, so a blocked client costs no hashing; the answer is `429` with `Retry-After` and "Trop de tentatives. Réessayez dans N minutes."

  | Key | Allowed | Then |
  |---|---|---|
  | Phone number (account or not) | 5 failures in 24 h | blocked 1, 2, 4… minutes, up to 1 h; a successful sign-in clears it |
  | Address, sign-in | 30 failures in 1 h | blocked 1, 2, 4… minutes, up to 30 min |
  | Address, sign-up | 10 attempts in 1 h | blocked 5, 10, 20… minutes, up to 1 h |

  The address limits are generous because mobile operators put many customers behind one address. IPv6 addresses count by `/64` network.
- **Requests from another site** (`apps/api/src/security/same-origin-json.ts`). Every `POST`, `PUT`, `PATCH` or `DELETE` must send its body as JSON (`415` otherwise: an HTML form cannot), and a browser request must come from `WEB_ORIGIN` (`403` when its `Origin` is another site or `Sec-Fetch-Site` says `cross-site`). This stops a third-party page from signing a visitor into another account (login CSRF) or acting in their name. Requests without these headers do not come from a browser and carry no visitor's cookies.
- **Security headers.** The API (`apps/api/src/security/security-headers.ts`) sends `nosniff`, `X-Frame-Options: DENY`, a CSP that allows nothing (`default-src 'none'; frame-ancestors 'none'`), `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, plus HSTS in production, and no `X-Powered-By`. The web app (`apps/web/src/lib/security-headers.ts`, applied in `next.config.ts`) sends a CSP with `frame-ancestors 'none'` (no page can be shown in another site's frame), sources limited to its own origin, `nosniff`, `Permissions-Policy` (position and camera for this site only), and HSTS and `upgrade-insecure-requests` in production. Its CSP keeps `'unsafe-inline'` for scripts, the Next.js variant without nonces, so pages stay static and cacheable; nonces are possible later at the cost of rendering every page on each request. A map with external tiles will need their host added to `img-src`.
- **Codes by SMS** (table `otp_codes`). `POST /auth/otp` sends a 6-digit code to a Togolese number (`+228` only), for one of two purposes:
  - `LOGIN_UNLOCK`: a number blocked after too many failures signs in with its password **and** the code, without waiting; whoever only knows the number can no longer lock its owner out;
  - `PASSWORD_RESET`: `POST /auth/password-reset` with the code sets a new password, closes every other session and signs in.

  A code is valid 10 minutes, for 5 tries, once; a new code replaces the previous one. Only an HMAC of the code is stored, keyed with `OTP_SECRET`. The answer to `/auth/otp` is the same whether the number has an account or not, and does not wait for the SMS. Requests are limited, since every SMS costs money: one per number, then 1, 2, 4… minutes before the next, up to 1 h; 10 per address and per hour. Wrong codes are counted per address too.
- **`SMS_PROVIDER`** chooses who sends the SMS (`apps/api/src/sms/sms.module.ts`). Only `console` exists for now: it writes the SMS, code included, in the API logs, and the API refuses to start with it in production. The real provider is still to be chosen; adding one means a class implementing `SmsSender` and its name in `SMS_PROVIDERS`.
- **`TRUST_PROXY`** names the proxies allowed to give the visitor's address (`X-Forwarded-For`): `loopback` by default, for the web app on the same machine. In production it must list **every** proxy in front of the API (the web app's server and any load balancer, as addresses or subnets); otherwise all visitors share the proxy's address and one person could block everyone. `true` is refused, since anyone could then forge their address.
- The browser calls the API through the web app (`/api/v1/*` is forwarded to `API_URL`, see `apps/web/next.config.ts`), so the cookie belongs to the web app's own origin. The web app's `proxy.ts` sends visitors without a cookie from `/pro` and `/admin` to `/connexion`; the pages then ask the API who is signed in. The API decides access in every case.

## Useful commands

| Command | Effect |
|---|---|
| `npm run lint` | Lint both applications |
| `npm test` | Unit tests |
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

1. Set `ADMIN_FULL_NAME`, `ADMIN_PHONE` (international format, e.g. `+22890000000`) and optionally `ADMIN_EMAIL`, in `.env` or in your shell.
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
