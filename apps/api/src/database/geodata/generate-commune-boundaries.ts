import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as prettier from 'prettier';
import { createDatabasePool } from '../database.module';
import { readDatabaseUrl } from '../load-env';
import {
  calibrateFromGrid,
  extractLayer,
  extractPaths,
  readGeoReference,
  readLayerTags,
  readPageContent,
  toUtm,
} from './geopdf';

/*
 * Regenerates seed-data/commune-boundaries.ts from the official map
 * "Communes du Grand Lomé" (MATDCL, 2019), a GeoPDF exported by ArcMap.
 *
 * Usage: npm run geo:boundaries -- <path/to/tg_matdcl_communes_du_grand_lome_2019.pdf>
 * Needs DATABASE_URL: PostGIS does the reprojection and the geometry repair.
 *
 * The PDF draws the communes as filled polygons in projected coordinates
 * (WGS 84 / UTM zone 31N). The script reads them, calibrates the page with the
 * map grid, checks that calibration against the geographic reference stored in
 * the PDF, and converts the polygons to WGS 84 longitude/latitude.
 */

export const SOURCE = {
  title: 'Communes du Grand Lomé',
  publisher:
    "Ministère de l'Administration territoriale, de la Décentralisation et des Collectivités locales (MATDCL)",
  date: '2019-04-25',
  url: 'https://www.pseau.org/outils/ouvrages/tg_matdcl_communes_du_grand_lome_2019.pdf',
  sha256: '45cdf21a5f32580a344f6f2f1d658d57b4b9049635df3d9c47fe352a51bfa1ee',
  layer: 'Limites_Commune__GrandLome',
};

const GRID_LAYER = 'Carroyage';
const GRID_EASTINGS = [
  285000, 290000, 295000, 300000, 305000, 310000, 315000, 320000,
];
const GRID_NORTHINGS = [680000, 685000, 690000, 695000, 700000];
const UTM_31N = 32631;
/** Maximum accepted gap between the grid calibration and the PDF's own reference. */
const MAX_CALIBRATION_ERROR_M = 10;
/** Pieces smaller than this are digitising artefacts, not parts of a commune. */
const MIN_PART_AREA_M2 = 100;
/** Output precision: 6 decimals of a degree, about 0.1 m. */
const GRID_DEGREES = 0.000001;

/*
 * Centre of each commune label on the map, in UTM 31N metres. Each polygon must
 * contain exactly one of these points: that is how a polygon gets its commune.
 * Commune number to label: see the note in seed-data/territory.ts.
 */
const LABELS: {
  slug: string;
  label: string;
  easting: number;
  northing: number;
}[] = [
  { slug: 'golfe-1', label: 'BE EST', easting: 308962, northing: 687544 },
  { slug: 'golfe-2', label: 'BE CENTRE', easting: 306354, northing: 684055 },
  { slug: 'golfe-3', label: 'BE OUEST', easting: 303204, northing: 685717 },
  { slug: 'golfe-4', label: 'AMOUTIVE', easting: 302737, northing: 678128 },
  { slug: 'golfe-5', label: 'AFLAO GAKLI', easting: 298680, northing: 685025 },
  { slug: 'golfe-6', label: 'BAGUIDA', easting: 316625, northing: 684105 },
  {
    slug: 'golfe-7',
    label: 'AFLAO SAGBADO',
    easting: 292385,
    northing: 684898,
  },
  {
    slug: 'agoe-nyive-1',
    label: 'AGOENYIVE',
    easting: 300700,
    northing: 688902,
  },
  {
    slug: 'agoe-nyive-2',
    label: 'LEGBASSITO',
    easting: 295901,
    northing: 693445,
  },
  {
    slug: 'agoe-nyive-3',
    label: 'VAKPOSSITO',
    easting: 296548,
    northing: 687824,
  },
  { slug: 'agoe-nyive-4', label: 'TOGBLE', easting: 302870, northing: 692722 },
  {
    slug: 'agoe-nyive-5',
    label: 'ZANGUERA',
    easting: 292399,
    northing: 690286,
  },
  {
    slug: 'agoe-nyive-6',
    label: 'ADETIKOPE',
    easting: 303816,
    northing: 698674,
  },
];

interface GeneratedBoundary {
  slug: string;
  label: string;
  areaKm2: number;
  geoJson: string;
}

async function main(): Promise<void> {
  if (!process.argv[2]) {
    throw new Error(
      'Usage: npm run geo:boundaries -- <path to the MATDCL PDF>',
    );
  }
  // npm runs workspace scripts from apps/api: resolve the path from where npm was called.
  const pdfPath = path.resolve(
    process.env.INIT_CWD ?? process.cwd(),
    process.argv[2],
  );

  const pdf = readFileSync(pdfPath);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  if (sha256 !== SOURCE.sha256) {
    throw new Error(
      `Unexpected file (sha256 ${sha256}). This script is written for one exact source; ` +
        'a new edition of the map must be reviewed before its data is used.',
    );
  }

  const tags = readLayerTags(pdf);
  const tagOf = (name: string) => {
    const tag = tags.get(name);
    if (!tag) throw new Error(`Layer "${name}" not found`);
    return tag;
  };
  const content = readPageContent(pdf);

  const grid = calibrateFromGrid(
    extractPaths(extractLayer(content, tagOf(GRID_LAYER))),
    GRID_EASTINGS,
    GRID_NORTHINGS,
  );
  const polygons = extractPaths(
    extractLayer(content, tagOf(SOURCE.layer)),
  ).filter((shape) => shape.operator !== 'S');
  if (polygons.length !== LABELS.length) {
    throw new Error(
      `Expected ${LABELS.length} commune polygons, found ${polygons.length}`,
    );
  }

  const pool = createDatabasePool(readDatabaseUrl());
  try {
    await checkCalibration(pool, pdf, grid);

    const wkts = polygons.map((shape) => {
      const rings = shape.rings.map((ring) => {
        const points = ring.map((point) => toUtm(point, grid));
        const [first, last] = [points[0], points[points.length - 1]];
        if (first[0] !== last[0] || first[1] !== last[1]) points.push(first);
        return `(${points.map(([e, n]) => `${e.toFixed(2)} ${n.toFixed(2)}`).join(',')})`;
      });
      return `POLYGON(${rings.join(',')})`;
    });

    const boundaries = await convert(pool, wkts);
    const output = path.join(
      __dirname,
      '..',
      'seed-data',
      'commune-boundaries.ts',
    );
    const source = renderSeedFile(boundaries, grid.metresPerPointX);
    const options = (await prettier.resolveConfig(output)) ?? {};
    writeFileSync(
      output,
      await prettier.format(source, { ...options, parser: 'typescript' }),
    );

    console.log(
      `Wrote ${boundaries.length} boundaries to ${path.relative(process.cwd(), output)}`,
    );
    for (const boundary of boundaries) {
      console.log(
        `  ${boundary.slug.padEnd(13)} ${boundary.label.padEnd(14)} ${boundary.areaKm2} km²`,
      );
    }
  } finally {
    await pool.end();
  }
}

/** The grid and the PDF's own geographic reference must agree within a few metres. */
async function checkCalibration(
  pool: ReturnType<typeof createDatabasePool>,
  pdf: Buffer,
  grid: ReturnType<typeof calibrateFromGrid>,
): Promise<void> {
  for (const reference of readGeoReference(pdf)) {
    const [easting, northing] = toUtm(reference.page, grid);
    const { rows } = await pool.query<{ metres: number }>(
      `SELECT ST_Distance(
         ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), ${UTM_31N}), 4326)::geography,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
       ) AS metres`,
      [easting, northing, reference.lng, reference.lat],
    );
    if (rows[0].metres > MAX_CALIBRATION_ERROR_M) {
      throw new Error(
        `Grid calibration is ${Math.round(rows[0].metres)} m away from the PDF reference`,
      );
    }
  }
}

/**
 * Repairs, names and converts the polygons.
 * 1. ST_MakeValid fixes the two self-intersections of the digitised lines.
 * 2. Pieces under 100 m² left by that repair are dropped.
 * 3. Each polygon takes the commune whose label it contains.
 * 4. The polygons are converted to WGS 84 and snapped to the 6-decimal grid of
 *    the output file, so that writing them adds no rounding.
 * 5. Neighbouring polygons overlap by a few hundred m² at most, where the
 *    digitised lines do not meet exactly. Each overlap is given to one commune
 *    (the first in slug order), so that any point falls in a single commune.
 *    The difference is computed on the same grid: computed first and rounded
 *    after, it would leave slivers of a few centimetres along shared limits.
 */
async function convert(
  pool: ReturnType<typeof createDatabasePool>,
  wkts: string[],
): Promise<GeneratedBoundary[]> {
  const labels = JSON.stringify(LABELS);
  const { rows } = await pool.query<GeneratedBoundary & { labelCount: number }>(
    `WITH raw AS (
       SELECT ordinality AS id, ST_MakeValid(ST_GeomFromText(wkt, ${UTM_31N})) AS geom
       FROM unnest($1::text[]) WITH ORDINALITY AS t(wkt)
     ),
     parts AS (
       SELECT id, (ST_Dump(ST_CollectionExtract(geom, 3))).geom AS geom FROM raw
     ),
     cleaned AS (
       SELECT id, ST_Union(geom) AS geom FROM parts
       WHERE ST_Area(geom) >= ${MIN_PART_AREA_M2} GROUP BY id
     ),
     label AS (
       SELECT slug, label, ST_SetSRID(ST_MakePoint(easting, northing), ${UTM_31N}) AS point
       FROM json_to_recordset($2::json) AS l(slug text, label text, easting float8, northing float8)
     ),
     named AS (
       SELECT c.id, c.geom, min(l.slug) AS slug, min(l.label) AS label, count(l.slug) AS label_count
       FROM cleaned c LEFT JOIN label l ON ST_Contains(c.geom, l.point)
       GROUP BY c.id, c.geom
     ),
     snapped AS (
       SELECT slug, label, label_count,
         ST_ReducePrecision(ST_Transform(geom, 4326), ${GRID_DEGREES}) AS geom
       FROM named
     ),
     resolved AS (
       SELECT a.slug, a.label, a.label_count,
         COALESCE(
           ST_Difference(a.geom, (
             SELECT ST_Union(b.geom, ${GRID_DEGREES}) FROM snapped b
             WHERE b.slug < a.slug AND ST_Intersects(a.geom, b.geom)
           ), ${GRID_DEGREES}),
           a.geom
         ) AS geom
       FROM snapped a
     ),
     final AS (
       SELECT slug, label, label_count,
         ST_Multi(ST_Union(part, ${GRID_DEGREES})) AS geom
       FROM (
         SELECT slug, label, label_count, (ST_Dump(ST_CollectionExtract(geom, 3))).geom AS part
         FROM resolved
       ) pieces
       WHERE ST_Area(part::geography) >= ${MIN_PART_AREA_M2}
       GROUP BY slug, label, label_count
     )
     SELECT slug, label, label_count::int AS "labelCount",
       round((ST_Area(geom::geography) / 1e6)::numeric, 2)::float8 AS "areaKm2",
       ST_AsGeoJSON(geom, 6) AS "geoJson"
     FROM final ORDER BY slug`,
    [wkts, labels],
  );

  for (const row of rows) {
    if (row.labelCount !== 1 || !row.slug) {
      throw new Error(
        `A polygon contains ${row.labelCount} commune labels instead of 1`,
      );
    }
  }
  if (new Set(rows.map((row) => row.slug)).size !== LABELS.length) {
    throw new Error('Some communes have no polygon');
  }

  // Rounding to 6 decimals (about 0.1 m) must not break any polygon.
  const { rows: invalid } = await pool.query<{ slug: string }>(
    `SELECT slug FROM json_to_recordset($1::json) AS b(slug text, "geoJson" text)
     WHERE NOT ST_IsValid(ST_GeomFromGeoJSON("geoJson"))`,
    [JSON.stringify(rows)],
  );
  if (invalid.length > 0) {
    throw new Error(
      `Invalid after rounding: ${invalid.map((row) => row.slug).join(', ')}`,
    );
  }

  return rows.map(({ slug, label, areaKm2, geoJson }) => ({
    slug,
    label,
    areaKm2,
    geoJson,
  }));
}

function renderSeedFile(
  boundaries: GeneratedBoundary[],
  metresPerPoint: number,
): string {
  const entries = boundaries.map((boundary) => {
    const geometry = JSON.parse(boundary.geoJson) as {
      coordinates: number[][][][];
    };
    return `  {
    slug: ${JSON.stringify(boundary.slug)},
    mapLabel: ${JSON.stringify(boundary.label)},
    areaKm2: ${boundary.areaKm2},
    multiPolygon: ${JSON.stringify(geometry.coordinates)},
  },`;
  });

  return `/*
 * GENERATED FILE: do not edit by hand. Regenerate with
 * npm run geo:boundaries -- <path to the source PDF>
 * (apps/api/src/database/geodata/generate-commune-boundaries.ts).
 *
 * Boundaries of the 13 communes of Grand Lomé.
 *
 * Source: ${SOURCE.publisher},
 * map "${SOURCE.title}", ${SOURCE.date}, layer ${SOURCE.layer}.
 * ${SOURCE.url}
 * sha256 ${SOURCE.sha256}
 *
 * The PDF is a GeoPDF in WGS 84 / UTM zone 31N; the polygons are its vector
 * paths, not a tracing. Coordinates are WGS 84 (EPSG:4326), longitude first,
 * rounded to 6 decimals.
 *
 * Accuracy: the export stores vertices on a 0.24 pt step, about
 * ${Math.round(metresPerPoint * 0.24)} m on the ground (${Math.round(metresPerPoint)} m per PDF point). The accuracy of the
 * ministry's own data is not documented, so these limits are official but not
 * surveyed. Overlaps of a few hundred m² between neighbours were given to one
 * commune so that every point falls in exactly one commune.
 */

export interface CommuneBoundarySeed {
  slug: string;
  /** Label of the commune on the source map, kept for traceability. */
  mapLabel: string;
  /** Area computed on the WGS 84 ellipsoid, for checks. */
  areaKm2: number;
  multiPolygon: number[][][][];
}

export const COMMUNE_BOUNDARIES: CommuneBoundarySeed[] = [
${entries.join('\n')}
];
`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
