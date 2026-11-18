/*
 * Grand Lomé territory: 1 region, 2 prefectures, 13 communes.
 *
 * Source of the commune names: law "portant création de communes", adopted by the
 * National Assembly on 23 June 2017 (Article 1). The chief towns and the
 * boundaries are set by a separate decree that is not loaded yet (ADR-028).
 */

export interface PrefectureSeed {
  name: string;
  slug: string;
  communes: { name: string; slug: string }[];
}

export const REGION = { name: 'Maritime', slug: 'maritime' };

function numberedCommunes(prefix: string, slugPrefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix} ${index + 1}`,
    slug: `${slugPrefix}-${index + 1}`,
  }));
}

export const PREFECTURES: PrefectureSeed[] = [
  {
    name: 'Golfe',
    slug: 'golfe',
    communes: numberedCommunes('Golfe', 'golfe', 7),
  },
  {
    name: 'Agoè-Nyivé',
    slug: 'agoe-nyive',
    communes: numberedCommunes('Agoè-Nyivé', 'agoe-nyive', 6),
  },
];

/*
 * Approximate centre of each commune, in WGS 84 decimal degrees.
 *
 * TO VERIFY before use in the dissertation: these points only help propose a
 * commune when boundaries are missing, and the user always confirms the commune.
 * Fill in one entry per commune (a pin on the commune's town hall or main
 * landmark is enough). Communes without an entry keep a NULL centroid.
 */
export const COMMUNE_CENTROIDS: { slug: string; lat: number; lng: number }[] =
  [];
