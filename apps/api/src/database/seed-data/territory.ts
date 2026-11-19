/*
 * Grand Lomé territory: 1 region, 2 prefectures, 13 communes.
 *
 * Source of the commune names: law "portant création de communes", adopted by the
 * National Assembly on 23 June 2017 (Article 1). The chief towns are set by a
 * separate decree, not found yet (ADR-028).
 *
 * Boundaries: MATDCL map "Communes du Grand Lomé" (2019), see
 * commune-boundaries.ts. That map names the communes but does not number them.
 * Number to map label:
 *   Golfe 1 BE EST, 2 BE CENTRE, 3 BE OUEST, 4 AMOUTIVE, 5 AFLAO GAKLI,
 *   6 BAGUIDA, 7 AFLAO SAGBADO;
 *   Agoè-Nyivé 1 AGOENYIVE, 2 LEGBASSITO, 3 VAKPOSSITO, 4 TOGBLE,
 *   5 ZANGUERA, 6 ADETIKOPE.
 * Checked on 2026-11-19 against citypopulation.de
 * (https://www.citypopulation.de/en/togo/lome/admin/): for each of the 13
 * numbered communes, its polygon has the position, shape and neighbourhoods of
 * the map label above. Also consistent with the chief towns published by the
 * Grand Lomé district (dagl.tg) and press reports ("Agoè-Nyivé 4 (Togblékopé)",
 * Koaci, 2020). citypopulation.de is a secondary source: the decree on chief
 * towns remains the primary source to cite (ADR-028).
 *
 * Known difference: citypopulation.de cuts the Adétikopé industrial platform
 * out of Agoè-Nyivé 6; the MATDCL 2019 map does not. The boundaries follow the
 * official map.
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
