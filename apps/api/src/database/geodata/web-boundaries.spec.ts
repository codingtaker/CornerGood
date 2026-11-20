import { readFileSync } from 'node:fs';
import { COMMUNE_BOUNDARIES } from '../seed-data/commune-boundaries';
import {
  generateWebBoundaries,
  serialiseWebBoundaries,
  WEB_BOUNDARIES_PATH,
} from './generate-web-boundaries';

describe('web boundaries', () => {
  const web = generateWebBoundaries();

  it('is up to date: run npm run geo:web after changing the boundaries', () => {
    expect(readFileSync(WEB_BOUNDARIES_PATH, 'utf8')).toBe(
      serialiseWebBoundaries(web),
    );
  });

  it('keeps the 13 communes with their names and the source credit', () => {
    expect(web.attribution).toBe('MATDCL, 2019');
    expect(web.features.map((commune) => commune.properties.slug)).toEqual(
      COMMUNE_BOUNDARIES.map((boundary) => boundary.slug),
    );
    expect(web.features[0].properties).toEqual({
      slug: 'agoe-nyive-1',
      name: 'Agoè-Nyivé 1',
      prefecture: 'Agoè-Nyivé',
      mapLabel: 'AGOENYIVE',
    });
  });

  it('is much lighter than the seed boundaries', () => {
    const size = Buffer.byteLength(serialiseWebBoundaries(web));
    expect(size).toBeLessThan(60 * 1024);
  });
});
