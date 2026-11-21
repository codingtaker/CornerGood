import { InvalidInputError } from '../auth/account-input';
import { readDraftListing, readPoint } from './listing-input';
import { listingSlug } from './listings.service';

const COMMUNE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CATEGORY = '33333333-3333-4333-8333-333333333333';

const fixed = {
  entityType: 'BUSINESS',
  categoryId: CATEGORY,
  name: '  Atelier   de Kossi ',
  phone: '90 12 34 56',
  location: {
    type: 'FIXED',
    communeId: COMMUNE,
    point: { lat: 6.1725, lng: 1.2314 },
    source: 'DEVICE_GPS',
    accuracyM: 12.6,
    capturedAt: new Date().toISOString(),
  },
};

function problemsOf(body: unknown): Record<string, string> {
  try {
    readDraftListing(body);
  } catch (error) {
    if (error instanceof InvalidInputError) return error.problems;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('readPoint', () => {
  it('reads degrees from numbers or query strings', () => {
    expect(readPoint({ lat: '6.17', lng: '1.21' })).toEqual({
      lat: 6.17,
      lng: 1.21,
    });
  });

  it.each([
    [{ lat: '', lng: '1' }],
    [{ lat: 'abc', lng: '1' }],
    [{ lat: 91, lng: 1 }],
    [{ lat: 6, lng: 181 }],
  ])('refuses %j', (raw) => {
    expect(readPoint(raw)).toBeNull();
  });
});

describe('readDraftListing', () => {
  it('reads a fixed activity met on the spot', () => {
    const input = readDraftListing(fixed);
    expect(input).toMatchObject({
      entityType: 'BUSINESS',
      name: 'Atelier de Kossi',
      phone: '+22890123456',
      whatsapp: null,
      description: null,
      location: {
        type: 'FIXED',
        point: { lat: 6.1725, lng: 1.2314 },
        source: 'DEVICE_GPS',
        accuracyM: 13,
        servedCommuneIds: [],
      },
    });
  });

  it('needs a position for a fixed activity', () => {
    expect(
      problemsOf({ ...fixed, location: { type: 'FIXED', communeId: COMMUNE } }),
    ).toEqual({
      'location.point':
        'Relevez la position devant votre activité, ou placez-la sur la carte.',
    });
  });

  it('refuses a position for a mobile activity, and needs its communes', () => {
    expect(
      problemsOf({
        ...fixed,
        location: { ...fixed.location, type: 'MOBILE' },
      }),
    ).toMatchObject({
      'location.point':
        "Une activité mobile n'a pas d'adresse fixe : pas de position.",
      'location.servedCommuneIds':
        'Choisissez au moins une commune où vous intervenez.',
    });
  });

  it('reads a mobile activity with the communes it serves', () => {
    const input = readDraftListing({
      ...fixed,
      location: {
        type: 'MOBILE',
        communeId: COMMUNE,
        servedCommuneIds: [COMMUNE, OTHER, OTHER],
      },
    });
    expect(input.location).toMatchObject({
      point: null,
      servedCommuneIds: [COMMUNE, OTHER],
    });
  });

  it('lets a home-based activity have no position', () => {
    expect(
      readDraftListing({
        ...fixed,
        location: { type: 'HOME_BASED', communeId: COMMUNE },
      }).location.point,
    ).toBeNull();
  });

  it('needs to know how a position was taken', () => {
    expect(
      problemsOf({
        ...fixed,
        location: { ...fixed.location, source: 'GUESS' },
      }),
    ).toEqual({
      'location.source': 'Indiquez comment la position a été relevée.',
    });
  });

  it('lists every problem of an empty form', () => {
    expect(Object.keys(problemsOf({})).sort()).toEqual([
      'categoryId',
      'entityType',
      'location.communeId',
      'location.type',
      'name',
    ]);
  });
});

describe('listingSlug', () => {
  it('makes a readable, unique slug without accents', () => {
    const slug = listingSlug('Réparation de téléphones Chez Kossi !');
    expect(slug).toMatch(/^reparation-de-telephones-chez-kossi-[0-9a-z]{6}$/);
    expect(listingSlug('Chez Kossi')).not.toBe(listingSlug('Chez Kossi'));
  });
});
