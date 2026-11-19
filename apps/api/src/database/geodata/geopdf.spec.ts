import { deflateSync } from 'node:zlib';
import {
  calibrateFromGrid,
  decodePdfString,
  extractLayer,
  extractPaths,
  readGeoReference,
  readLayerTags,
  readPageContent,
  toUtm,
} from './geopdf';

/** Builds a tiny PDF with the structure of an ArcMap GeoPDF. */
function buildPdf(content: string): Buffer {
  const utf16 = (name: string) =>
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`${name}\0`, 'utf16le'),
    ]).toString('latin1');
  const stream = deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj\r\n<<\r\n/Filter /FlateDecode\r\n>>\r\nstream\r\n',
      'latin1',
    ),
    stream,
    Buffer.from(
      '\r\nendstream\r\nendobj\n' +
        `5 0 obj\r\n<</Type/OCG/Name (${utf16('Communes')})/Usage<<>>>>\r\nendobj\n` +
        `6 0 obj\r\n<</Type/OCG/Name (${utf16('Grid')})/Usage<<>>>>\r\nendobj\n` +
        '7 0 obj\r\n<</Properties<</OC1 5 0 R /OC2 6 0 R >>>>\r\nendobj\n' +
        '8 0 obj\r\n<</Type/Measure/Subtype/GEO/GPTS[6.1 1.0 6.4 1.0 6.4 1.4 6.1 1.4 ]' +
        '/LPTS[0 1 0 0 1 0 1 1 ]>>\r\nendobj\n' +
        '9 0 obj\r\n<<\r\n/Type /Page\r\n/Contents 1 0 R\r\n' +
        '/VP[<</Type/Viewport/BBox[10 500 810 20]/Measure 8 0 R >>]\r\n>>\r\nendobj\n',
      'latin1',
    ),
  ]);
}

const CONTENT = [
  '/OC /OC1 BDC',
  'q',
  '0 0 m 100 0 l 100 100 l 0 0 l h',
  'W* n',
  '0.8 0.9 0.9 rg',
  '10 10 m 20 10 l 20 20 l 10 10 l h',
  'B*',
  '30 30 m 40 30 l 40 40 l h 32 32 m 34 32 l 34 34 l h',
  'f*',
  'Q',
  'EMC',
  '/OC /OC2 BDC',
  // Two grid crosses on each axis, 100 pt apart, plus a long frame line.
  '48 50 m 52 50 l S',
  '50 48 m 50 52 l S',
  '148 150 m 152 150 l S',
  '150 148 m 150 152 l S',
  '0 300 m 800 300 l S',
  'EMC',
].join('\n');

describe('geopdf', () => {
  const pdf = buildPdf(CONTENT);

  it('maps layer names to their content tags', () => {
    expect(readLayerTags(pdf)).toEqual(
      new Map([
        ['Communes', 'OC1'],
        ['Grid', 'OC2'],
      ]),
    );
  });

  it('decodes UTF-16 names and drops the trailing NUL written by ArcMap', () => {
    const raw = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Limites défaut\0', 'utf16le'),
    ]).toString('latin1');
    expect(decodePdfString(raw)).toBe('Limites défaut');
  });

  it('inflates the page content stream', () => {
    expect(readPageContent(pdf)).toBe(CONTENT);
  });

  it('extracts the painted shapes of one layer and ignores clipping paths', () => {
    const paths = extractPaths(extractLayer(readPageContent(pdf), 'OC1'));
    expect(paths).toEqual([
      {
        operator: 'B*',
        rings: [
          [
            [10, 10],
            [20, 10],
            [20, 20],
            [10, 10],
          ],
        ],
      },
      {
        operator: 'f*',
        rings: [
          [
            [30, 30],
            [40, 30],
            [40, 40],
          ],
          [
            [32, 32],
            [34, 32],
            [34, 34],
          ],
        ],
      },
    ]);
  });

  it('refuses curves instead of silently flattening them', () => {
    expect(() => extractPaths('0 0 m 1 1 2 2 3 3 c f')).toThrow(/Curves/);
  });

  it('calibrates the page from the grid crosses and ignores long lines', () => {
    const grid = calibrateFromGrid(
      extractPaths(extractLayer(readPageContent(pdf), 'OC2')),
      [300000, 305000],
      [680000, 685000],
    );
    expect(toUtm([50, 50], grid)).toEqual([300000, 680000]);
    expect(toUtm([150, 150], grid)).toEqual([305000, 685000]);
    expect(toUtm([100, 100], grid)).toEqual([302500, 682500]);
  });

  it('fails when the grid is not evenly spaced', () => {
    const paths = extractPaths(
      '48 50 m 52 50 l S 50 48 m 50 52 l S 160 150 m 164 150 l S',
    );
    expect(() => calibrateFromGrid(paths, [0, 1, 2], [0])).toThrow(
      /evenly spaced/,
    );
  });

  it('places the geographic reference points on the map frame', () => {
    expect(readGeoReference(pdf)).toEqual([
      { page: [10, 20], lat: 6.1, lng: 1.0 },
      { page: [10, 500], lat: 6.4, lng: 1.0 },
      { page: [810, 500], lat: 6.4, lng: 1.4 },
      { page: [810, 20], lat: 6.1, lng: 1.4 },
    ]);
  });
});
