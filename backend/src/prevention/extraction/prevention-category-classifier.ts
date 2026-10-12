export type PreventionCategoryDefinition = {
  code: string;
  label: string;
  description: string;
  color: string;
  displayOrder: number;
  keywords: readonly string[];
};

export const PREVENTION_CATEGORY_CATALOG: readonly PreventionCategoryDefinition[] = [
  {
    code: 'Hauteur',
    label: 'Travaux en hauteur',
    description: 'Chutes de hauteur, accès en hauteur et protections collectives.',
    color: '#3182CE',
    displayOrder: 10,
    keywords: ['travail en hauteur', 'travaux en hauteur', 'chute de hauteur', 'garde corps', 'echafaudage', 'echafaudages', 'toiture', 'echelle', 'echelles', 'escabeau', 'escabeaux', 'pirl', 'nacelle', 'tremie', 'passerelle', 'plateforme elevatrice', 'plateforme suspendue', 'vide'],
  },
  {
    code: 'Circulation',
    label: 'Circulation & Accès',
    description: 'Circulations, accès, cheminements et séparation des flux.',
    color: '#805AD5',
    displayOrder: 20,
    keywords: ['circulation', 'acces', 'cheminement', 'passage', 'pieton', 'engin', 'vehicule', 'flux', 'sol glissant', 'fouille', 'tranchee', 'cable au sol', 'dechargement'],
  },
  {
    code: 'EPI',
    label: 'EPI & Équipements',
    description: 'Équipements de protection individuelle et équipements de travail.',
    color: '#E53E3E',
    displayOrder: 30,
    keywords: ['epi', 'equipement de protection', 'equipements de protection', 'casque', 'gant', 'gants', 'lunette', 'lunettes', 'masque', 'harnais', 'chaussure de securite', 'chaussures de securite', 'protection auditive', 'protection respiratoire', 'carter de protection', 'outil', 'outils', 'disqueuse'],
  },
  {
    code: 'Éclairage',
    label: 'Éclairage',
    description: 'Éclairage des postes, accès et zones de travail.',
    color: '#D69E2E',
    displayOrder: 40,
    keywords: ['eclairage', 'luminaire', 'lumiere', 'zone sombre', 'obscurite', 'visibilite insuffisante'],
  },
  {
    code: 'Levage',
    label: 'Levage & Manutention',
    description: 'Levage, manutention et charges suspendues.',
    color: '#38A169',
    displayOrder: 50,
    keywords: ['levage', 'manutention', 'charge suspendue', 'grue', 'pont roulant', 'elingue', 'palan', 'chariot elevateur'],
  },
  {
    code: 'Organisation',
    label: 'Organisation & Stockage',
    description: 'Organisation du chantier, stockage, ordre, propreté et coactivité.',
    color: '#DD6B20',
    displayOrder: 60,
    keywords: ['organisation du chantier', 'organisation chantier', 'stockage', 'rangement', 'ordre', 'proprete', 'coactivite', 'balisage', 'signalisation', 'encombrement', 'obstacle', 'dechet', 'dechets', 'ppsps', 'coordination', 'ibc', 'cuve', 'cuves', 'bidon', 'bidons'],
  },
  {
    code: 'Incendie',
    label: 'Incendie',
    description: 'Prévention incendie, évacuation et moyens de secours.',
    color: '#C53030',
    displayOrder: 70,
    keywords: ['incendie', 'extincteur', 'extincteurs', 'depart de feu', 'fumee', 'alarme incendie', 'issue de secours', 'plan evacuation', 'evacuation des personnes', 'evacuation du personnel', 'point de rassemblement'],
  },
  {
    code: 'Admin',
    label: 'Admin.',
    description: 'Certifications, attestations, habilitations et conformité documentaire.',
    color: '#718096',
    displayOrder: 80,
    keywords: ['certification', 'certifications', 'certificat', 'attestation', 'attestations', 'habilitation', 'habilitations', 'autorisation', 'autorisations', 'registre', 'permis', 'signature', 'signatures', 'document incomplet', 'document illisible', 'document expire', 'document expiré', 'conformite documentaire', 'certificat de conformite', 'attestation de conformite', 'declaration de conformite', 'preuve de conformite'],
  },
  {
    code: 'Électrique',
    label: 'Électrique',
    description: 'Installations, équipements et interventions électriques.',
    color: '#B7791F',
    displayOrder: 90,
    keywords: ['electrique', 'electricite', 'installation electrique', 'armoire electrique', 'tableau electrique', 'cable electrique', 'cable denude', 'fil denude', 'prise electrique', 'tension', 'consignation electrique', 'contact electrique'],
  },
] as const;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyPreventionCategory(...parts: Array<string | null | undefined>): string | null {
  const text = normalize(parts.filter(Boolean).join(' '));
  if (!text) return null;
  const haystack = ` ${text} `;

  // A document finding about an electrical authorisation/certification is
  // administrative. The electrical category is reserved for an actual
  // electrical installation, equipment or exposure described in the finding.
  const administrative = PREVENTION_CATEGORY_CATALOG.find((category) => category.code === 'Admin');
  const electrical = PREVENTION_CATEGORY_CATALOG.find((category) => category.code === 'Électrique');
  const adminScore = administrative?.keywords.reduce((total, keyword) => total + (haystack.includes(` ${normalize(keyword)} `) ? 1 : 0), 0) ?? 0;
  const electricalScore = electrical?.keywords.reduce((total, keyword) => total + (haystack.includes(` ${normalize(keyword)} `) ? 1 : 0), 0) ?? 0;
  if (adminScore > 0 && electricalScore > 0 && /(?:habilitation|attestation|certification|autorisation|registre|permis|signature|document|certificat|declaration|preuve)/.test(text)) {
    return 'Admin';
  }

  let selected: PreventionCategoryDefinition | null = null;
  let selectedScore = 0;
  for (const category of PREVENTION_CATEGORY_CATALOG) {
    const score = category.keywords.reduce(
      (total, keyword) => total + (haystack.includes(` ${normalize(keyword)} `) ? 1 : 0),
      0,
    );
    if (score > selectedScore) {
      selected = category;
      selectedScore = score;
    }
  }
  return selected?.code ?? null;
}

export function classifyPreventionFinding(finding: {
  content: string;
  danger: string | null;
  risk: string | null;
}): string | null {
  return classifyPreventionCategory(finding.content, finding.danger, finding.risk);
}
