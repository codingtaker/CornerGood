import { inflateSync } from 'node:zlib';

/*
 * Minimal reader for the vector layers of a GeoPDF exported by Esri ArcMap.
 *
 * It only understands what such an export contains: one page, one Flate-encoded
 * content stream, layers marked with "/OC /<tag> BDC ... EMC", and paths built
 * with the "m", "l" and "h" operators. It is not a general PDF parser, and it
 * fails loudly on anything else rather than returning partial data.
 */

export type PagePoint = [x: number, y: number];

export interface PagePath {
  /** Painting operator: "B*"/"f" fill a shape, "S" only strokes a line. */
  operator: string;
  rings: PagePoint[][];
}

const PAINT_OPERATORS = new Set([
  'B',
  'B*',
  'b',
  'b*',
  'f',
  'f*',
  'F',
  'S',
  's',
]);

/** Maps each layer name to its tag in the content stream (e.g. "OC1"). */
export function readLayerTags(pdf: Buffer): Map<string, string> {
  const text = pdf.toString('latin1');
  const namesByObject = new Map<string, string>();
  for (const match of text.matchAll(
    /(\d+) 0 obj\s*<<\s*\/Type\s*\/OCG\s*\/Name\s*\(([^)]*)\)/g,
  )) {
    namesByObject.set(match[1], decodePdfString(match[2]));
  }

  const properties = /\/Properties\s*<<([^>]*)>>/.exec(text);
  if (!properties)
    throw new Error('No /Properties dictionary: not a layered PDF');

  const tags = new Map<string, string>();
  for (const match of properties[1].matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
    const name = namesByObject.get(match[2]);
    if (name) tags.set(name, match[1]);
  }
  return tags;
}

/**
 * Text strings are either PDFDocEncoding (≈ Latin-1) or UTF-16 with a BOM.
 * ArcMap also writes a trailing NUL character, which is removed.
 */
export function decodePdfString(raw: string): string {
  const bytes = Buffer.from(raw, 'latin1');
  let decoded = raw;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    decoded = bytes.subarray(2).toString('utf16le');
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    decoded = Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  }
  return decoded.replace(/\0+$/, '');
}

/** Inflates the content stream of the single page of the document. */
export function readPageContent(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const page = /\/Type\s*\/Page\b[\s\S]*?\/Contents\s+(\d+) 0 R/.exec(text);
  if (!page) throw new Error('Page content stream not found');

  const object = new RegExp(`(?:^|\\n)${page[1]} 0 obj`).exec(text);
  if (!object) throw new Error(`Object ${page[1]} not found`);
  const start = text.indexOf('stream', object.index);
  const dataStart = start + (text[start + 6] === '\r' ? 8 : 7);
  const end = text.indexOf('endstream', dataStart);
  if (start < 0 || end < 0) throw new Error('Malformed content stream');

  return inflateSync(pdf.subarray(dataStart, end)).toString('latin1');
}

/** Returns the operators of one layer, including its nested layers. */
export function extractLayer(content: string, tag: string): string {
  const lines = content.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() === `/OC /${tag} BDC`);
  if (first < 0)
    throw new Error(`Layer ${tag} not found in the content stream`);

  const layer: string[] = [];
  let depth = 0;
  for (const line of lines.slice(first)) {
    const trimmed = line.trim();
    if (trimmed.endsWith('BDC')) depth += 1;
    if (trimmed === 'EMC') {
      depth -= 1;
      if (depth === 0) return layer.join('\n');
    }
    layer.push(trimmed);
  }
  throw new Error(`Layer ${tag} is not closed`);
}

/**
 * Collects the painted paths of a layer. Clipping paths (ended by "W n" or
 * "W* n") only restrict drawing to the map frame, so they are discarded.
 */
export function extractPaths(layer: string): PagePath[] {
  const paths: PagePath[] = [];
  let rings: PagePoint[][] = [];
  let ring: PagePoint[] | null = null;
  let operands: number[] = [];

  const closeRing = () => {
    if (ring && ring.length > 0) rings.push(ring);
    ring = null;
  };

  for (const token of layer.split(/\s+/)) {
    if (token === 'm' || token === 'l') {
      if (operands.length < 2)
        throw new Error(`"${token}" without coordinates`);
      const point: PagePoint = [
        operands[operands.length - 2],
        operands[operands.length - 1],
      ];
      if (token === 'm') {
        closeRing();
        ring = [point];
      } else {
        if (!ring) throw new Error('"l" before "m"');
        ring.push(point);
      }
      operands = [];
    } else if (token === 'c' || token === 'v' || token === 'y') {
      throw new Error(
        'Curves are not supported: the export should only contain lines',
      );
    } else if (token === 'cm') {
      // A transformation would move the coordinates read so far.
      throw new Error(
        '"cm" (coordinate transformation) is not supported: paths would be misplaced',
      );
    } else if (token === 're') {
      throw new Error('"re" (rectangle) is not supported');
    } else if (token === 'h') {
      closeRing();
    } else if (PAINT_OPERATORS.has(token)) {
      closeRing();
      paths.push({ operator: token, rings });
      rings = [];
    } else if (token === 'n') {
      ring = null;
      rings = [];
    } else {
      const value = Number(token);
      operands =
        Number.isFinite(value) && token !== '' ? [...operands, value] : [];
    }
  }
  return paths;
}

export interface GridCalibration {
  /** Page coordinates of the first grid cross and the matching UTM values. */
  x0: number;
  y0: number;
  easting0: number;
  northing0: number;
  /** Metres per PDF point along each axis. */
  metresPerPointX: number;
  metresPerPointY: number;
}

/**
 * Calibrates page coordinates against the grid crosses of the map.
 * A cross is drawn as short horizontal and vertical arms; their positions give
 * the cross columns and rows, which must be evenly spaced.
 */
export function calibrateFromGrid(
  gridPaths: PagePath[],
  eastings: number[],
  northings: number[],
  armMaxLength = 20,
): GridCalibration {
  const segments = gridPaths
    .filter((path) => path.operator === 'S')
    .flatMap((path) => path.rings)
    .filter((ring) => ring.length === 2);

  const columns = distinct(
    segments
      .filter(([a, b]) => a[0] === b[0] && Math.abs(a[1] - b[1]) < armMaxLength)
      .map(([a]) => a[0]),
  );
  const rows = distinct(
    segments
      .filter(([a, b]) => a[1] === b[1] && Math.abs(a[0] - b[0]) < armMaxLength)
      .map(([a]) => a[1]),
  );

  // The frame ticks are arms too: keep the runs that match the expected counts.
  const xs = evenRun(columns, eastings.length, 'columns');
  const ys = evenRun(rows, northings.length, 'rows');

  return {
    x0: xs[0],
    y0: ys[0],
    easting0: eastings[0],
    northing0: northings[0],
    metresPerPointX:
      (eastings[eastings.length - 1] - eastings[0]) /
      (xs[xs.length - 1] - xs[0]),
    metresPerPointY:
      (northings[northings.length - 1] - northings[0]) /
      (ys[ys.length - 1] - ys[0]),
  };
}

export function toUtm(
  point: PagePoint,
  grid: GridCalibration,
): [number, number] {
  return [
    grid.easting0 + (point[0] - grid.x0) * grid.metresPerPointX,
    grid.northing0 + (point[1] - grid.y0) * grid.metresPerPointY,
  ];
}

function distinct(values: number[]): number[] {
  return [
    ...new Set(values.map((value) => Math.round(value * 1000) / 1000)),
  ].sort((a, b) => a - b);
}

/** Finds `count` values spaced evenly, within 0.01 pt. */
function evenRun(values: number[], count: number, label: string): number[] {
  for (let start = 0; start + count <= values.length; start += 1) {
    const run = values.slice(start, start + count);
    const step = (run[count - 1] - run[0]) / (count - 1);
    if (
      step > 0 &&
      run.every(
        (value, index) => Math.abs(value - (run[0] + index * step)) < 0.01,
      )
    ) {
      return run;
    }
  }
  throw new Error(`No ${count} evenly spaced grid ${label} found`);
}

export interface GeoReferencePoint {
  page: PagePoint;
  lat: number;
  lng: number;
}

/**
 * Reads the geographic reference that ArcMap writes for the map frame:
 * /LPTS are points of the frame in unit coordinates, /GPTS their latitude and
 * longitude. Used to check the grid calibration independently.
 */
export function readGeoReference(pdf: Buffer): GeoReferencePoint[] {
  const text = pdf.toString('latin1');
  const numbers = (pattern: RegExp, label: string) => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`No ${label} in this PDF: not a GeoPDF`);
    return match[1].trim().split(/\s+/).map(Number);
  };
  const [x0, y0, x1, y1] = numbers(
    /\/Viewport\s*\/BBox\s*\[([^\]]+)\]/,
    '/Viewport',
  );
  const unit = numbers(/\/LPTS\s*\[([^\]]+)\]/, '/LPTS');
  const geo = numbers(/\/GPTS\s*\[([^\]]+)\]/, '/GPTS');
  if (unit.length !== geo.length)
    throw new Error('/LPTS and /GPTS differ in length');

  const points: GeoReferencePoint[] = [];
  for (let index = 0; index + 1 < geo.length; index += 2) {
    points.push({
      page: [x0 + unit[index] * (x1 - x0), y0 + unit[index + 1] * (y1 - y0)],
      lat: geo[index],
      lng: geo[index + 1],
    });
  }
  return points;
}
