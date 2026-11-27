import { readOpeningHours } from './opening-hours';

describe('readOpeningHours', () => {
  it('reads closed days, one range and two ranges', () => {
    expect(
      readOpeningHours({
        mon: [
          ['08:00', '12:00'],
          ['14:00', '18:00'],
        ],
        sat: [['09:00', '24:00']],
        sun: [],
      }),
    ).toEqual({
      mon: [
        ['08:00', '12:00'],
        ['14:00', '18:00'],
      ],
      sat: [['09:00', '24:00']],
      sun: [],
    });
  });

  it('gives null when nothing is said', () => {
    expect(readOpeningHours(undefined)).toBeNull();
    expect(readOpeningHours(null)).toBeNull();
    expect(readOpeningHours({})).toBeNull();
  });

  it.each([
    [{ lun: [] }, /Jour inconnu/],
    [{ mon: 'fermé' }, /au plus 2 plages/],
    [
      {
        mon: [
          ['08:00', '10:00'],
          ['11:00', '12:00'],
          ['13:00', '14:00'],
        ],
      },
      /au plus 2 plages/,
    ],
    [{ mon: [['8h', '12:00']] }, /mal écrite/],
    [{ mon: [['24:00', '24:00']] }, /mal écrite/],
    [{ mon: [['25:00', '26:00']] }, /mal écrite/],
    [{ mon: [['18:00', '08:00']] }, /finir après/],
    [
      {
        mon: [
          ['08:00', '13:00'],
          ['12:00', '18:00'],
        ],
      },
      /chevaucher/,
    ],
    [[['08:00', '12:00']], /illisibles/],
  ])('refuses %j', (value, message) => {
    expect(() => readOpeningHours(value)).toThrow(message);
  });
});
