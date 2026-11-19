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
cp .env.example .env                       # then change POSTGRES_PASSWORD and DATABASE_URL
cp apps/web/.env.example apps/web/.env.local
npm install
npm run db:up                              # starts PostgreSQL + PostGIS on localhost:$DB_PORT (default 5432)
npm run db:migrate                         # creates the tables
npm run db:seed                            # loads the 13 communes and the initial categories
npm run dev:api                            # http://localhost:3001/api/v1/health
npm run dev:web                            # http://localhost:3000
```

`GET /api/v1/health` returns the PostGIS version when the database is reachable, and `503` otherwise.

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
| `npm run db:seed` | Load reference data; safe to run several times. Communes are updated; categories are only added when missing, so edits made by administrators are kept |
| `npm run geo:boundaries -- <pdf>` | Regenerate the commune boundaries from the ministry's GeoPDF (see *Data sources*); needs `DATABASE_URL` for PostGIS |
| `npm run db:down` | Stop the database (data is kept in a Docker volume) |

To create the test database once Docker is running:

```bash
docker compose exec db createdb -U cornergood cornergood_test
# then, in .env or your shell:
# TEST_DATABASE_URL=postgres://cornergood:<password>@localhost:$DB_PORT/cornergood_test
```

## Database conventions

- Migrations are plain SQL inside Kysely migration files, numbered `0001_…`, `0002_…`. A merged migration is never edited: a change goes into a new migration.
- Closed lists are `text` columns with a `CHECK`, not PostgreSQL `ENUM` types, so values can be changed later.
- Single-row business rules (location types, a reason for every rejection, one primary location, one pending revision) are enforced by constraints as well as by the API.
- `moderation_log` is append-only: a trigger rejects any update or deletion.
- Coordinates are `geography(Point, 4326)`; remember that `ST_MakePoint` takes the **longitude first**.

## Rules

- Never commit `.env` files: this repository is public.
- Code, identifiers and comments in English; product text in French.
- Design decisions are recorded in the project's decision register (ADR-001 to ADR-042).

## Data sources

| Data | Source | Licence |
|---|---|---|
| Names of the 13 communes | Law n° 2017-008 of 29 June 2017 creating the communes | Public |
| Boundaries of the 13 communes | MATDCL, map *Communes du Grand Lomé* (25 April 2019), GeoPDF distributed by [pS-Eau](https://www.pseau.org/outils/ouvrages/tg_matdcl_communes_du_grand_lome_2019.pdf), layer `Limites_Commune__GrandLome` | Official publication, no licence stated: credit the ministry |

The boundaries are the vector polygons of the ministry's GeoPDF, converted to WGS 84 by `npm run geo:boundaries -- <path to the PDF>` (see `apps/api/src/database/geodata`). The script refuses any file other than the reviewed edition (checked by SHA-256). The PDF names the communes without numbering them: the number of each commune is documented in `seed-data/territory.ts` and still has to be confirmed with the decree that sets the chief towns. **Any map that shows these boundaries must credit "MATDCL, 2019".**

## Licence

MIT (code). Data keeps the licence of its source, listed above.
