/*
 * PROVISIONAL starter catalogue of services (ADR-006, ADR-024), drafted on
 * 2026-11-27 so that professionals have something to tick. To be checked
 * against the answers of the field survey and corrected here.
 *
 * Like categories, a service is only created when missing: once in the
 * database it belongs to the administrators, and a new run of the seed never
 * overwrites a renamed or deactivated one. Slugs are unique across the whole
 * catalogue, hence the category prefix.
 */
export const SERVICES: Record<string, { name: string; slug: string }[]> = {
  commerce: [
    { name: 'Alimentation générale', slug: 'commerce-alimentation' },
    { name: 'Vêtements et chaussures', slug: 'commerce-vetements' },
    { name: 'Cosmétiques et beauté', slug: 'commerce-cosmetiques' },
    { name: 'Téléphones et accessoires', slug: 'commerce-telephones' },
    { name: 'Quincaillerie', slug: 'commerce-quincaillerie' },
    { name: 'Vente en gros', slug: 'commerce-gros' },
  ],
  restauration: [
    { name: 'Plats locaux', slug: 'restauration-plats-locaux' },
    { name: 'Petit-déjeuner', slug: 'restauration-petit-dejeuner' },
    { name: 'Grillades', slug: 'restauration-grillades' },
    { name: 'Boissons et jus', slug: 'restauration-boissons' },
    { name: 'Plats à emporter', slug: 'restauration-a-emporter' },
    { name: 'Traiteur pour événements', slug: 'restauration-traiteur' },
  ],
  artisanat: [
    { name: 'Couture sur mesure', slug: 'artisanat-couture' },
    { name: 'Coiffure et tresses', slug: 'artisanat-coiffure' },
    { name: 'Menuiserie', slug: 'artisanat-menuiserie' },
    { name: 'Soudure et ferronnerie', slug: 'artisanat-soudure' },
    { name: 'Maçonnerie', slug: 'artisanat-maconnerie' },
    { name: 'Cordonnerie', slug: 'artisanat-cordonnerie' },
  ],
  reparation: [
    {
      name: "Remplacement d'écran de téléphone",
      slug: 'reparation-ecran-telephone',
    },
    {
      name: 'Batterie et charge de téléphone',
      slug: 'reparation-batterie-telephone',
    },
    { name: "Réparation d'ordinateurs", slug: 'reparation-ordinateurs' },
    { name: 'Électroménager', slug: 'reparation-electromenager' },
    { name: 'Mécanique moto', slug: 'reparation-moto' },
    { name: 'Mécanique auto', slug: 'reparation-auto' },
    { name: 'Électricité du bâtiment', slug: 'reparation-electricite' },
    { name: 'Plomberie', slug: 'reparation-plomberie' },
  ],
  'services-professionnels': [
    { name: 'Secrétariat et saisie', slug: 'pro-secretariat' },
    { name: 'Photocopie et impression', slug: 'pro-impression' },
    { name: "Transfert d'argent mobile", slug: 'pro-transfert-argent' },
    { name: 'Comptabilité', slug: 'pro-comptabilite' },
    { name: 'Photographie et vidéo', slug: 'pro-photographie' },
    { name: 'Nettoyage', slug: 'pro-nettoyage' },
  ],
  transport: [
    { name: 'Taxi-moto (zémidjan)', slug: 'transport-taxi-moto' },
    { name: 'Taxi', slug: 'transport-taxi' },
    { name: 'Livraison de colis', slug: 'transport-livraison' },
    { name: 'Déménagement', slug: 'transport-demenagement' },
    { name: 'Location de véhicule', slug: 'transport-location' },
  ],
  formation: [
    { name: 'Cours de soutien scolaire', slug: 'formation-soutien-scolaire' },
    { name: 'Informatique et bureautique', slug: 'formation-informatique' },
    { name: 'Langues', slug: 'formation-langues' },
    { name: "Apprentissage d'un métier", slug: 'formation-apprentissage' },
    { name: 'Auto-école', slug: 'formation-auto-ecole' },
  ],
  sante: [
    { name: 'Pharmacie', slug: 'sante-pharmacie' },
    { name: 'Consultation', slug: 'sante-consultation' },
    { name: 'Soins infirmiers', slug: 'sante-soins-infirmiers' },
    { name: "Laboratoire d'analyses", slug: 'sante-laboratoire' },
    { name: 'Médecine traditionnelle', slug: 'sante-traditionnelle' },
  ],
  'autre-activite': [
    { name: 'Événementiel', slug: 'autre-evenementiel' },
    { name: 'Agriculture et élevage', slug: 'autre-agriculture' },
    { name: 'Immobilier', slug: 'autre-immobilier' },
  ],
  'etablissement-scolaire': [
    { name: 'Maternelle', slug: 'ecole-maternelle' },
    { name: 'Primaire', slug: 'ecole-primaire' },
    { name: 'Collège', slug: 'ecole-college' },
    { name: 'Lycée', slug: 'ecole-lycee' },
    { name: 'Enseignement technique', slug: 'ecole-technique' },
    { name: 'Cantine scolaire', slug: 'ecole-cantine' },
  ],
  'centre-de-sante': [
    { name: 'Consultations', slug: 'cs-consultations' },
    { name: 'Maternité', slug: 'cs-maternite' },
    { name: 'Vaccination', slug: 'cs-vaccination' },
    { name: 'Urgences', slug: 'cs-urgences' },
    { name: 'Laboratoire', slug: 'cs-laboratoire' },
    { name: 'Pharmacie', slug: 'cs-pharmacie' },
  ],
  marche: [
    { name: 'Vivres frais', slug: 'marche-vivres' },
    { name: 'Poisson et viande', slug: 'marche-poisson-viande' },
    { name: 'Tissus et pagnes', slug: 'marche-tissus' },
    { name: 'Articles ménagers', slug: 'marche-menagers' },
  ],
  bibliotheque: [
    { name: 'Consultation sur place', slug: 'bibliotheque-consultation' },
    { name: 'Prêt de livres', slug: 'bibliotheque-pret' },
    { name: 'Accès internet', slug: 'bibliotheque-internet' },
    { name: 'Espace de travail', slug: 'bibliotheque-travail' },
  ],
  'equipement-sportif': [
    { name: 'Football', slug: 'sport-football' },
    { name: 'Basket-ball', slug: 'sport-basket' },
    { name: 'Salle de sport', slug: 'sport-salle' },
    { name: 'Piscine', slug: 'sport-piscine' },
  ],
  'centre-culturel': [
    { name: 'Spectacles', slug: 'culture-spectacles' },
    { name: 'Expositions', slug: 'culture-expositions' },
    { name: 'Ateliers', slug: 'culture-ateliers' },
    { name: 'Location de salle', slug: 'culture-location-salle' },
  ],
  'association-ong': [
    { name: 'Aide sociale', slug: 'ong-aide-sociale' },
    { name: 'Santé communautaire', slug: 'ong-sante' },
    { name: 'Éducation', slug: 'ong-education' },
    { name: 'Formation professionnelle', slug: 'ong-formation' },
  ],
  'service-public': [
    { name: 'État civil', slug: 'public-etat-civil' },
    { name: "Pièces d'identité", slug: 'public-identite' },
    { name: 'Impôts et taxes', slug: 'public-impots' },
    { name: 'Poste', slug: 'public-poste' },
  ],
  'lieu-de-culte': [
    { name: 'Offices', slug: 'culte-offices' },
    { name: 'Activités pour les jeunes', slug: 'culte-jeunes' },
    { name: 'Aide sociale', slug: 'culte-aide-sociale' },
  ],
  'autre-structure': [
    { name: 'Accueil du public', slug: 'structure-accueil' },
    { name: 'Information', slug: 'structure-information' },
  ],
};
