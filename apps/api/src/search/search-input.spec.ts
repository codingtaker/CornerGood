import { InvalidInputError } from '../auth/account-input';
import {
  DEFAULT_RADIUS_METRES,
  fold,
  MAX_WORDS,
  queryWords,
  readSearchQuery,
} from './search-input';

function problems(query: Record<string, unknown>): Record<string, string> {
  try {
    readSearchQuery(query);
  } catch (error) {
    if (error instanceof InvalidInputError) return error.problems;
    throw error;
  }
  throw new Error('expected invalid input');
}

describe('search input (contract §4.1)', () => {
  it('folds accents and case like search_fold()', () => {
    expect(fold("Remplacement d'ÉCRAN, Santé")).toBe(
      "remplacement d'ecran, sante",
    );
  });

  it('keeps the useful words of a query, once each', () => {
    expect(queryWords('Réparation de téléphone près de chez moi')).toEqual([
      'reparation',
      'telephone',
    ]);
    expect(queryWords('écran ECRAN écran')).toEqual(['ecran']);
    expect(queryWords('a b c d e f g h i j kk ll mm nn oo pp qq')).toHaveLength(
      MAX_WORDS,
    );
  });

  it('reads a keyword search with the default page', () => {
    expect(readSearchQuery({ q: '  couture   Bè ' })).toEqual({
      words: ['couture', 'be'],
      category: null,
      service: null,
      commune: null,
      entityType: null,
      near: null,
      bbox: null,
      page: 1,
      limit: 20,
    });
  });

  it('refuses an empty search', () => {
    expect(problems({})).toHaveProperty('q');
    expect(problems({ q: '   ', page: '2' })).toHaveProperty('q');
  });

  it('refuses a query made only of empty words, or too long', () => {
    expect(problems({ q: 'de la' })).toEqual({
      q: 'Précisez ce que vous cherchez.',
    });
    expect(problems({ q: 'x' })).toHaveProperty('q');
    expect(problems({ q: 'a'.repeat(81) })).toHaveProperty('q');
  });

  it('accepts a category, a service or a commune alone', () => {
    expect(readSearchQuery({ category: 'reparation' }).category).toBe(
      'reparation',
    );
    expect(readSearchQuery({ service: 'reparation-ecran' }).service).toBe(
      'reparation-ecran',
    );
    expect(readSearchQuery({ commune: 'golfe-1' }).commune).toBe('golfe-1');
    expect(problems({ category: "x' OR 1=1" })).toHaveProperty('category');
  });

  it('reads a position with the default radius, or a given one', () => {
    expect(readSearchQuery({ lat: '6.13', lng: '1.22' }).near).toEqual({
      point: { lat: 6.13, lng: 1.22 },
      radiusMetres: DEFAULT_RADIUS_METRES,
    });
    expect(
      readSearchQuery({ lat: '6.13', lng: '1.22', radius: '500' }).near
        ?.radiusMetres,
    ).toBe(500);
  });

  it('wants both coordinates, and a radius only with them', () => {
    expect(problems({ lat: '6.13' })).toHaveProperty('position');
    expect(problems({ lat: '6.13', lng: 'abc' })).toHaveProperty('position');
    expect(problems({ q: 'couture', radius: '500' })).toHaveProperty('radius');
    expect(
      problems({ lat: '6.13', lng: '1.22', radius: '50000' }),
    ).toHaveProperty('radius');
  });

  it('reads a map viewport, never with a radius', () => {
    expect(readSearchQuery({ bbox: '1.1,6.1,1.3,6.3' }).bbox).toEqual({
      minLng: 1.1,
      minLat: 6.1,
      maxLng: 1.3,
      maxLat: 6.3,
    });
    expect(problems({ bbox: '1.3,6.1,1.1,6.3' })).toHaveProperty('bbox');
    expect(problems({ bbox: '1.1,6.1,1.3' })).toHaveProperty('bbox');
    expect(
      problems({
        bbox: '1.1,6.1,1.3,6.3',
        lat: '6.2',
        lng: '1.2',
        radius: '900',
      }),
    ).toHaveProperty('bbox');
  });

  it('bounds the page and its size', () => {
    expect(
      readSearchQuery({ q: 'couture', page: '3', limit: '10' }),
    ).toMatchObject({ page: 3, limit: 10 });
    expect(problems({ q: 'couture', page: '0' })).toHaveProperty('page');
    expect(problems({ q: 'couture', page: '51' })).toHaveProperty('page');
    expect(problems({ q: 'couture', limit: '51' })).toHaveProperty('limit');
    expect(problems({ q: 'couture', limit: '1.5' })).toHaveProperty('limit');
  });

  it('reads the kind of listing and ignores unknown parameters', () => {
    expect(
      readSearchQuery({ entityType: 'COMMUNITY', publicationStatus: 'DRAFT' }),
    ).toMatchObject({ entityType: 'COMMUNITY' });
    expect(problems({ entityType: 'PERSON' })).toHaveProperty('entityType');
  });

  it('takes the first value of a repeated parameter', () => {
    expect(readSearchQuery({ q: ['couture', 'garage'] }).words).toEqual([
      'couture',
    ]);
  });
});
