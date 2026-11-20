import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { COMMUNE_BOUNDARIES } from '../seed-data/commune-boundaries';
import { PREFECTURES } from '../seed-data/territory';
import { buildWebBoundaries, WebBoundaries } from './web-boundaries';

/*
 * Writes the light boundaries the web app draws, from the seed boundaries.
 * Usage: npm run geo:web (after npm run geo:boundaries, whenever it changes).
 * No database needed. A unit test fails when the file is out of date.
 */

/**
 * Visvalingam threshold. Measured on the 13 communes (test:db): 2 363 vertices
 * out of 4 215, borders moved by 23 m at most. The source map stores vertices
 * about every 13 m, so this loses nothing a viewer could trust; 1 000 m² would
 * save 17 KB but move borders by up to 68 m.
 */
export const MIN_TRIANGLE_AREA_M2 = 250;

export const WEB_BOUNDARIES_PATH = path.join(
  __dirname,
  '../../../../web/public/data/communes.geojson',
);

export function generateWebBoundaries(): WebBoundaries {
  const names = new Map(
    PREFECTURES.flatMap((prefecture) =>
      prefecture.communes.map(
        (commune) =>
          [
            commune.slug,
            { name: commune.name, prefecture: prefecture.name },
          ] as const,
      ),
    ),
  );
  return buildWebBoundaries(COMMUNE_BOUNDARIES, names, MIN_TRIANGLE_AREA_M2, {
    attribution: 'MATDCL, 2019',
    source:
      'MATDCL, map "Communes du Grand Lomé" (2019), simplified for display; ' +
      'see apps/api/src/database/geodata/generate-web-boundaries.ts',
  });
}

export function serialiseWebBoundaries(web: WebBoundaries): string {
  return JSON.stringify(web) + '\n';
}

function main(): void {
  const web = generateWebBoundaries();
  const json = serialiseWebBoundaries(web);
  mkdirSync(path.dirname(WEB_BOUNDARIES_PATH), { recursive: true });
  writeFileSync(WEB_BOUNDARIES_PATH, json);

  const vertices = web.features.reduce(
    (total, commune) =>
      total +
      (commune.geometry.type === 'Polygon'
        ? commune.geometry.coordinates.flat().length
        : commune.geometry.coordinates.flat(2).length),
    0,
  );
  const sourceVertices = COMMUNE_BOUNDARIES.reduce(
    (total, boundary) => total + boundary.multiPolygon.flat(2).length,
    0,
  );
  console.log(
    `Wrote ${web.features.length} communes to ${path.relative(process.cwd(), WEB_BOUNDARIES_PATH)}: ` +
      `${(json.length / 1024).toFixed(1)} KB, ${vertices} vertices (from ${sourceVertices}).`,
  );
}

if (require.main === module) main();
