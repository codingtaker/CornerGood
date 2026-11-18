import type { EntityType } from '../database.types';

/*
 * Initial categories, taken from the answer lists of the two Kobo field
 * questionnaires (economic actors and community structures, version 2026103101),
 * so that survey answers and platform categories can be compared.
 */
export interface CategorySeed {
  name: string;
  slug: string;
  applicableTo: EntityType;
}

export const CATEGORIES: CategorySeed[] = [
  // Economic actors
  { name: 'Commerce', slug: 'commerce', applicableTo: 'BUSINESS' },
  { name: 'Restauration', slug: 'restauration', applicableTo: 'BUSINESS' },
  { name: 'Artisanat', slug: 'artisanat', applicableTo: 'BUSINESS' },
  { name: 'Réparation', slug: 'reparation', applicableTo: 'BUSINESS' },
  {
    name: 'Services professionnels',
    slug: 'services-professionnels',
    applicableTo: 'BUSINESS',
  },
  { name: 'Transport', slug: 'transport', applicableTo: 'BUSINESS' },
  { name: 'Formation', slug: 'formation', applicableTo: 'BUSINESS' },
  { name: 'Santé', slug: 'sante', applicableTo: 'BUSINESS' },
  { name: 'Autre activité', slug: 'autre-activite', applicableTo: 'BUSINESS' },

  // Community structures
  {
    name: 'Établissement scolaire',
    slug: 'etablissement-scolaire',
    applicableTo: 'COMMUNITY',
  },
  {
    name: 'Centre de santé / clinique',
    slug: 'centre-de-sante',
    applicableTo: 'COMMUNITY',
  },
  { name: 'Marché', slug: 'marche', applicableTo: 'COMMUNITY' },
  { name: 'Bibliothèque', slug: 'bibliotheque', applicableTo: 'COMMUNITY' },
  {
    name: 'Équipement sportif',
    slug: 'equipement-sportif',
    applicableTo: 'COMMUNITY',
  },
  {
    name: 'Centre culturel',
    slug: 'centre-culturel',
    applicableTo: 'COMMUNITY',
  },
  {
    name: 'Association / ONG',
    slug: 'association-ong',
    applicableTo: 'COMMUNITY',
  },
  {
    name: 'Service public / administratif',
    slug: 'service-public',
    applicableTo: 'COMMUNITY',
  },
  { name: 'Lieu de culte', slug: 'lieu-de-culte', applicableTo: 'COMMUNITY' },
  {
    name: 'Autre structure',
    slug: 'autre-structure',
    applicableTo: 'COMMUNITY',
  },
];
