import { createHash } from 'crypto';
import { preventionActionDefinition, safePreventionActionType } from '../prevention-action-types';

type ActionFamily = { id: string; title: string; categoryKey: string; terms: RegExp[] };

// A budget line represents a costed intervention, not the wording of one SPS
// recommendation. Keep this vocabulary deliberately narrow: an unrecognised
// action retains its analytical pattern key instead of being merged by category.
const ACTION_FAMILIES: readonly ActionFamily[] = [
  { id: 'height-training', title: 'Formation sécurité travaux en hauteur', categoryKey: 'Hauteur', terms: [/form(?:er|ation)|sensibilis|causerie/, /hauteur|garde.?corps|echafaud|nacelle|echelle|pirl|tremie/] },
  { id: 'height-protection', title: 'Protections collectives contre les chutes', categoryKey: 'Hauteur', terms: [/garde.?corps|platelage|recouvrement|tremie/] },
  { id: 'height-protection', title: 'Protections collectives contre les chutes', categoryKey: 'Hauteur', terms: [/protection collective/, /hauteur|chute|tremie|bord de dalle|vide/] },
  { id: 'height-access', title: 'Moyens d’accès sécurisés en hauteur', categoryKey: 'Hauteur', terms: [/escalier|echelle|echafaudage|pirl|nacelle|passerelle/, /acces|montee|descente|hauteur|travail/] },
  { id: 'ppe-supply', title: 'EPI complémentaires — dotation et stock', categoryKey: 'EPI', terms: [/casque|harnais|gant|lunette|masque|chaussure de securite|epi|protection respiratoire/, /fournir|doter|remplacer|equiper|mettre a disposition|stock|dotation|complet/] },
  { id: 'ppe-enforcement', title: 'Contrôle et rappel du port des EPI', categoryKey: 'EPI', terms: [/casque|harnais|gant|lunette|chaussure de securite|epi/, /controle|verifi|rappel|impos|port systematique/] },
  { id: 'equipment-compliance', title: 'Audit et mise en conformité de l’outillage', categoryKey: 'EPI', terms: [/outil|outillage|disqueuse|meuleuse|carter|equipement de travail/, /controle|audit|verifi|conform|remplac|protection/] },
  { id: 'lighting', title: 'Éclairage des zones de travail et de circulation', categoryKey: 'Éclairage', terms: [/eclairag|luminaire|lumiere|zone sombre|obscurite/] },
  { id: 'traffic-plan', title: 'Signalisation et plan de circulation chantier', categoryKey: 'Circulation', terms: [/plan de circulation|signalisation|panneau|jalonnement|jalon|marquage au sol|limitation de vitesse|consigne de circulation/] },
  { id: 'traffic-plan', title: 'Signalisation et plan de circulation chantier', categoryKey: 'Circulation', terms: [/signaler/, /circulation|engin|vehicule|pieton|acces|croisement|manoeuvre|piste/] },
  { id: 'traffic-separation', title: 'Séparation et balisage des circulations', categoryKey: 'Circulation', terms: [/balisage|barrierage|barriere|separ|delimit|cheminement pieton|zone de travail|filet plastique|rubalise|ouverture laterale/, /circulation|engin|vehicule|pieton|travail|acces|travee|cheminement/] },
  { id: 'excavation-dewatering', title: 'Pompage et drainage des fouilles', categoryKey: 'Circulation', terms: [/pompage|drainage|desaturation/, /fouille|tranchee|eau stagnante/] },
  { id: 'excavation-stability', title: 'Stabilité des talus et déblais de fouille', categoryKey: 'Circulation', terms: [/talus|deblai|geotechni|talutage/, /fouille|tranchee|crete|stabilite/] },
  { id: 'excavation-protection', title: 'Protection et accès aux fouilles', categoryKey: 'Circulation', terms: [/fouille|tranchee|excavation|terrassement/, /proteg|barrier|blindage|acces|signal|securis/] },
  { id: 'site-documents', title: 'Contrôle des justificatifs et habilitations', categoryKey: 'Admin', terms: [/habilitation|carte btp|attestation|justificatif|document/, /copie|lisib|verifi|archiv|reemettre|presentation|controle/] },
  { id: 'electrical-compliance', title: 'Contrôle et mise en conformité des installations électriques', categoryKey: 'Électrique', terms: [/electri|consignation|differentiel|tableau|armoire|cable|enrouleur|appareillage/, /controle|verifi|conform|proteg|securis|remplac|consign/] },
  { id: 'fire-protection', title: 'Moyens de prévention incendie', categoryKey: 'Incendie', terms: [/incendie|extincteur|depart de feu|bouteille de gaz|evacuation (?:des personnes|du personnel)/] },
  { id: 'lifting-controls', title: 'Sécurisation du levage et de la manutention', categoryKey: 'Levage', terms: [/levage|elingue|grue|palan|charge suspendue|manutention/] },
  { id: 'spill-retention', title: 'Rétention des produits et protection des sols', categoryKey: 'Organisation', terms: [/ibc|cuve|bidon|hydrocarbure|produit chimique|retention|pollution des sols/, /retention|etanche|stock|proteg|collect|plateforme|aire dediee/] },
  { id: 'waste-management', title: 'Organisation du tri et de la propreté', categoryKey: 'Organisation', terms: [/dechet|benne|tri selectif/] },
  { id: 'dust-control', title: 'Maîtrise des poussières', categoryKey: 'Organisation', terms: [/poussiere|arrosage des pistes/] },
  { id: 'site-water', title: 'Gestion des eaux de chantier', categoryKey: 'Organisation', terms: [/eaux de chantier|decantation|ecoulement/, /canalis|collect|trait|gestion|proteg/] },
  { id: 'site-storage', title: 'Organisation et sécurisation des stockages', categoryKey: 'Organisation', terms: [/stockage|rangement|palette|materiaux/, /organis|separ|proteg|securis|delimit|barrier|evacu/] },
  { id: 'sps-coordination', title: 'Renforcement de la coordination SPS', categoryKey: 'Organisation', terms: [/coordination|ppsps|visite supplementaire|reunion de chantier|causerie securite/] },
];

function normalized(value: string): string {
  return value.toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function budgetActionGroup(finding: { categoryKey: string; content: string; actionType?: string | null; patternKey?: string | null; normalizedKey?: string | null }): { itemKey: string; title: string; familyId: string | null; categoryKey: string } {
  if (finding.actionType !== undefined) {
    const action = preventionActionDefinition(safePreventionActionType(finding.actionType, finding.content));
    if (action?.id === 'specific-action') {
      const sourceKey = finding.patternKey || finding.normalizedKey || createHash('sha256').update(normalized(finding.content)).digest('hex');
      return { itemKey: createHash('sha256').update(`budget-specific-action-v1|${sourceKey}`).digest('hex'),
        title: `Mesure spécifique — ${finding.content.slice(0, 420)}`, familyId: action.id, categoryKey: finding.categoryKey };
    }
    if (action) return {
      itemKey: createHash('sha256').update(`budget-action-type-v1|${action.id}`).digest('hex'),
      title: action.title, familyId: action.id, categoryKey: action.categoryKey,
    };
    const text = normalized(finding.content);
    const sourceKey = finding.patternKey || finding.normalizedKey || createHash('sha256').update(text).digest('hex');
    return { itemKey: createHash('sha256').update(`budget-action-unclassified-v1|${sourceKey}`).digest('hex'),
      title: `Mesure spécifique — ${finding.content.slice(0, 420)}`, familyId: null, categoryKey: finding.categoryKey };
  }
  const text = normalized(finding.content);
  const family = ACTION_FAMILIES.find((candidate) => candidate.terms.every((term) => term.test(text)));
  if (!family) {
    const itemKey = finding.patternKey || finding.normalizedKey || createHash('sha256').update(`budget-action-unclassified|${finding.categoryKey}|${text}`).digest('hex');
    return { itemKey: String(itemKey), title: finding.content.slice(0, 500), familyId: null, categoryKey: finding.categoryKey };
  }
  const itemKey = createHash('sha256').update(`budget-action-v2|${family.id}`).digest('hex');
  return { itemKey, title: family.title, familyId: family.id, categoryKey: family.categoryKey };
}

export function isPriceableActionGroup(findings: ReadonlyArray<{ actionType?: string | null; content?: string }>): boolean {
  return findings.length > 0 && findings.every((finding) =>
    Boolean(preventionActionDefinition(safePreventionActionType(finding.actionType, finding.content ?? ''))));
}
