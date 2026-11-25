import { missingForSubmission, SubmissionCandidate } from './submission';

const complete: SubmissionCandidate = {
  entityType: 'BUSINESS',
  categoryActive: true,
  description: 'Réparation de téléphones.',
  phone: '+22890123456',
  whatsapp: null,
  location: { type: 'FIXED', hasPoint: true, servedCommunes: 0 },
};
const missing = (change: Partial<SubmissionCandidate>) =>
  Object.keys(missingForSubmission({ ...complete, ...change }));

describe('missingForSubmission', () => {
  it('accepts a complete listing', () => {
    expect(missing({})).toEqual([]);
  });

  it('names everything that is missing at once', () => {
    expect(missing({ description: '  ', phone: null, location: null })).toEqual(
      ['description', 'phone', 'location'],
    );
  });

  it('accepts a WhatsApp number alone, or a community place without any', () => {
    expect(missing({ phone: null, whatsapp: '+22890123456' })).toEqual([]);
    expect(missing({ phone: null, entityType: 'COMMUNITY' })).toEqual([]);
  });

  it('asks for a usable location of each type', () => {
    const location = (type: 'FIXED' | 'MOBILE' | 'HOME_BASED', served = 0) =>
      missing({ location: { type, hasPoint: false, servedCommunes: served } });
    expect(location('FIXED')).toEqual(['location']);
    expect(location('MOBILE')).toEqual(['location']);
    expect(location('MOBILE', 1)).toEqual([]);
    // The commune of a home is enough: its point is optional.
    expect(location('HOME_BASED')).toEqual([]);
  });

  it('refuses a category deactivated since', () => {
    expect(missing({ categoryActive: false })).toEqual(['categoryId']);
  });
});
