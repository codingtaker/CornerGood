/*
 * Opening hours of a listing (contract §5.1): for each day, closed (an empty
 * list) or one or two ranges, e.g. { "mon": [["08:00","12:00"],["14:00","18:00"]],
 * "sun": [] }. A day left out is unknown, not closed. Times are Lomé time
 * (UTC, no daylight saving), as "HH:MM"; a range ending at midnight is
 * written "24:00".
 */

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export type OpeningHours = Partial<Record<Day, [string, string][]>>;

export const MAX_RANGES_PER_DAY = 2;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/**
 * The opening hours of a body, or null when none are given. Throws a French
 * message for anything else than the format above.
 */
export function readOpeningHours(value: unknown): OpeningHours | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Horaires illisibles.');
  }
  const hours: OpeningHours = {};
  for (const [key, ranges] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const day = DAYS.find((d) => d === key);
    if (!day) throw new Error(`Jour inconnu : ${key}.`);
    if (!Array.isArray(ranges) || ranges.length > MAX_RANGES_PER_DAY) {
      throw new Error(
        `Indiquez fermé ou au plus ${MAX_RANGES_PER_DAY} plages par jour.`,
      );
    }
    const read: [string, string][] = [];
    let previousEnd = -1;
    for (const range of ranges) {
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        typeof range[0] !== 'string' ||
        typeof range[1] !== 'string' ||
        !TIME.test(range[0]) ||
        !TIME.test(range[1]) ||
        range[0] === '24:00'
      ) {
        throw new Error('Une heure est mal écrite (exemple : 08:30).');
      }
      const start = minutes(range[0]);
      const end = minutes(range[1]);
      if (end <= start) {
        throw new Error("Une plage doit finir après l'heure d'ouverture.");
      }
      if (start < previousEnd) {
        throw new Error(
          'Les plages d’un jour doivent se suivre sans se chevaucher.',
        );
      }
      previousEnd = end;
      read.push([range[0], range[1]]);
    }
    hours[day] = read;
  }
  return Object.keys(hours).length > 0 ? hours : null;
}
