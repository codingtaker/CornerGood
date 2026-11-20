import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from 'geojson';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import type { CommuneBoundarySeed } from '../seed-data/commune-boundaries';

/*
 * Light version of the commune boundaries for the web app (PWA), which only
 * draws them. Locating a point stays on the server, on the full boundaries.
 *
 * The simplification is topological: TopoJSON stores each border shared by two
 * communes once, as an arc, and simplifies that arc once. Both neighbours keep
 * exactly the same border, so no gap or overlap appears between them, which
 * simplifying each polygon on its own would cause.
 */

export interface CommuneProperties {
  slug: string;
  name: string;
  prefecture: string;
  /** Label of the commune on the MATDCL map. */
  mapLabel: string;
}

export type WebBoundaries = FeatureCollection<
  Polygon | MultiPolygon,
  CommuneProperties
> & {
  /** Credit required by the source (README, "Data sources"). */
  attribution: string;
  source: string;
};

/** Metres per degree around Lomé (6.2° N), to express the threshold in m². */
const METRES_PER_DEGREE_LAT = 110_600;
const METRES_PER_DEGREE_LNG = 110_670;
/**
 * Quantisation grid: 1/1 000 000 of the extent, about 4 cm here. A coarser
 * grid (1e5) moves nearly coincident borders apart and creates overlaps.
 */
const QUANTIZATION = 1e6;
/**
 * Output precision: 6 decimals of a degree (about 0.1 m), as in the seed. With
 * 5 decimals, borders that nearly coincide overlap by a few hundred m².
 */
const DECIMALS = 6;

/**
 * @param minTriangleAreaM2 Visvalingam threshold: a vertex is removed when the
 * triangle it forms with its neighbours is smaller than this area.
 */
export function buildWebBoundaries(
  boundaries: CommuneBoundarySeed[],
  names: Map<string, { name: string; prefecture: string }>,
  minTriangleAreaM2: number,
  source: { attribution: string; source: string },
): WebBoundaries {
  const input: FeatureCollection<MultiPolygon, CommuneProperties> = {
    type: 'FeatureCollection',
    features: boundaries.map((boundary) => {
      const names_ = names.get(boundary.slug);
      if (!names_) throw new Error(`No name for commune ${boundary.slug}`);
      return {
        type: 'Feature',
        properties: {
          slug: boundary.slug,
          name: names_.name,
          prefecture: names_.prefecture,
          mapLabel: boundary.mapLabel,
        },
        geometry: { type: 'MultiPolygon', coordinates: boundary.multiPolygon },
      };
    }),
  };

  // The typings of topojson-server and topojson-simplify disagree on the
  // properties type; the objects are the same.
  const topo = presimplify(
    topology({ communes: input }, QUANTIZATION) as unknown as Parameters<
      typeof presimplify
    >[0],
  );
  const minWeight =
    minTriangleAreaM2 / (METRES_PER_DEGREE_LAT * METRES_PER_DEGREE_LNG);
  const simplified = simplify(topo, minWeight);
  const output = feature(
    simplified,
    simplified.objects.communes,
  ) as FeatureCollection<Polygon | MultiPolygon, CommuneProperties>;

  const features = output.features.map(
    (commune): Feature<Polygon | MultiPolygon, CommuneProperties> => {
      if (!commune.geometry || commune.geometry.coordinates.length === 0) {
        throw new Error(
          `Commune ${commune.properties.slug} vanished when simplified`,
        );
      }
      return {
        type: 'Feature',
        properties: commune.properties,
        geometry: roundGeometry(commune.geometry),
      };
    },
  );

  return { type: 'FeatureCollection', ...source, features };
}

function roundGeometry(
  geometry: Polygon | MultiPolygon,
): Polygon | MultiPolygon {
  const factor = 10 ** DECIMALS;
  const round = (ring: number[][]) =>
    ring.map(([lng, lat]) => [
      Math.round(lng * factor) / factor,
      Math.round(lat * factor) / factor,
    ]);
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(round) }
    : {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => polygon.map(round)),
      };
}
