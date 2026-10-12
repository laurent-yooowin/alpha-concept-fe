import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetActionGroup, isPriceableActionGroup } from './prevention-budget-grouping';

test('different recommendations for the same height protection become one budget action', () => {
  const first = budgetActionGroup({
    categoryKey: 'Hauteur', patternKey: 'a'.repeat(64),
    content: 'Installer des garde-corps complets autour de la trémie.',
  });
  const second = budgetActionGroup({
    categoryKey: 'Hauteur', patternKey: 'b'.repeat(64),
    content: 'Mettre en place un platelage stable et fixé pour protéger la trémie.',
  });
  assert.equal(first.itemKey, second.itemKey);
  assert.equal(first.title, 'Protections collectives contre les chutes');
  assert.notEqual(first.itemKey, 'a'.repeat(64));
});

test('training, collective protection and soil protection remain distinct budget actions', () => {
  const training = budgetActionGroup({ categoryKey: 'Hauteur', content: 'Former les équipes au travail en hauteur et aux garde-corps.' });
  const protection = budgetActionGroup({ categoryKey: 'Hauteur', content: 'Installer un garde-corps autour de la trémie.' });
  const soil = budgetActionGroup({ categoryKey: 'Organisation', content: 'Installer une aire de rétention étanche pour les cuves IBC.' });
  assert.notEqual(training.itemKey, protection.itemKey);
  assert.notEqual(soil.itemKey, protection.itemKey);
});

test('the same corrective action across different analytical categories remains one organization budget item', () => {
  const first = budgetActionGroup({ categoryKey: 'Organisation', content: 'Installer un garde-corps autour de la trémie.' });
  const second = budgetActionGroup({ categoryKey: 'Hauteur', content: 'Installer des garde-corps complets autour de la trémie.' });
  assert.equal(first.itemKey, second.itemKey);
  assert.equal(first.categoryKey, 'Hauteur');
});

test('equipment control, circulation plan and lighting are separate canonical actions', () => {
  const equipment = budgetActionGroup({ categoryKey: 'EPI', content: 'Auditer et mettre en conformité l’outillage électroportatif.' });
  const circulation = budgetActionGroup({ categoryKey: 'Circulation', content: 'Formaliser le plan de circulation chantier.' });
  const lighting = budgetActionGroup({ categoryKey: 'Organisation', content: 'Installer un éclairage permanent dans les zones enterrées.' });
  assert.equal(equipment.title, 'Audit et mise en conformité de l’outillage');
  assert.equal(circulation.title, 'Signalisation et plan de circulation chantier');
  assert.equal(lighting.categoryKey, 'Éclairage');
  assert.equal(new Set([equipment.itemKey, circulation.itemKey, lighting.itemKey]).size, 3);
});

test('repeated dewatering and document checks form distinct cost actions', () => {
  const drain = budgetActionGroup({ categoryKey: 'Circulation', content: 'Installer un système de pompage et de drainage pour supprimer l’eau stagnante dans la fouille.' });
  const drainAgain = budgetActionGroup({ categoryKey: 'Circulation', content: 'Mettre en œuvre un dispositif de pompage du fond de fouille et maintenir la tranchée au sec.' });
  const document = budgetActionGroup({ categoryKey: 'Admin', content: 'Fournir et archiver une copie lisible de chaque titre d’habilitation électrique.' });
  const electrical = budgetActionGroup({ categoryKey: 'Électrique', content: 'Contrôler et mettre en conformité les installations électriques provisoires.' });
  assert.equal(drain.itemKey, drainAgain.itemKey);
  assert.equal(drain.title, 'Pompage et drainage des fouilles');
  assert.equal(document.categoryKey, 'Admin');
  assert.notEqual(document.itemKey, electrical.itemKey);
});

test('generic collective protection outside work at height is not a height budget action', () => {
  const soil = budgetActionGroup({ categoryKey: 'Organisation', content: 'Mettre en place une protection collective des sols contre les hydrocarbures.' });
  const height = budgetActionGroup({ categoryKey: 'Hauteur', content: 'Mettre en place une protection collective contre les chutes de hauteur.' });
  assert.notEqual(soil.itemKey, height.itemKey);
  assert.equal(height.categoryKey, 'Hauteur');
});

test('signaling belongs to traffic planning only with circulation evidence', () => {
  const traffic = budgetActionGroup({ categoryKey: 'Circulation', content: 'Signaler les croisements et les manœuvres des engins sur les pistes.' });
  const fire = budgetActionGroup({ categoryKey: 'Incendie', content: 'Signaler tout départ de feu et mettre à disposition des extincteurs.' });
  const electrical = budgetActionGroup({ categoryKey: 'Électrique', content: 'Signaler une anomalie électrique et sécuriser le tableau.' });
  assert.equal(traffic.familyId, 'traffic-plan');
  assert.equal(fire.familyId, 'fire-protection');
  assert.equal(electrical.familyId, 'electrical-compliance');
});

test('unrecognised actions keep their exact analytical identity', () => {
  const unknown = budgetActionGroup({ categoryKey: 'Organisation', patternKey: 'c'.repeat(64), content: 'Vérifier ce point particulier.' });
  assert.equal(unknown.itemKey, 'c'.repeat(64));
});

test('mixed tri and evacuation are costed together, never as tri-only or fire protection', () => {
  const waste = budgetActionGroup({ categoryKey: 'Incendie', actionType: 'waste-management',
    content: 'Organiser l’évacuation des déchets et le tri en bennes.' });
  const fire = budgetActionGroup({ categoryKey: 'Incendie', actionType: 'fire-protection',
    content: 'Contrôler les extincteurs et les issues de secours.' });
  assert.equal(waste.familyId, 'waste-complete');
  assert.equal(waste.categoryKey, 'Organisation');
  assert.notEqual(waste.itemKey, fire.itemKey);
});

test('legacy and ambiguous recommendations cannot acquire a priced action from a regex', () => {
  const legacy = budgetActionGroup({ categoryKey: 'Incendie', actionType: null,
    content: 'Évacuer les déchets du chantier.', patternKey: 'a'.repeat(64) });
  const ambiguous = budgetActionGroup({ categoryKey: 'Incendie', actionType: 'A_CLASSER',
    content: 'Évacuer les déchets du chantier.', patternKey: 'a'.repeat(64) });
  assert.equal(legacy.familyId, null);
  assert.equal(ambiguous.familyId, null);
  assert.equal(legacy.itemKey, ambiguous.itemKey);
  assert.equal(isPriceableActionGroup([{ actionType: null }]), false);
  assert.equal(isPriceableActionGroup([{ actionType: 'A_CLASSER' }]), false);
  assert.equal(isPriceableActionGroup([{ actionType: 'waste-management', content: 'Organiser le tri des déchets.' }]), true);
});

test('a hallucinated fire type on waste evacuation is never priced as fire protection', () => {
  const finding = { categoryKey: 'Organisation', actionType: 'fire-protection',
    content: 'Organiser l’évacuation des déchets vers les bennes.' };
  assert.equal(budgetActionGroup(finding).familyId, null);
  assert.equal(isPriceableActionGroup([finding]), false);
});

test('dust control combined with runoff works stays unpriced until its scope is separated', () => {
  const finding = { categoryKey: 'Organisation', actionType: 'dust-control',
    content: 'Arroser les pistes et créer des rigoles pour les eaux de ruissellement.' };
  assert.equal(budgetActionGroup(finding).familyId, null);
  assert.equal(isPriceableActionGroup([finding]), false);
});

test('dust and water action types follow the recommendation evidence, not an inverted AI label', () => {
  const dust = budgetActionGroup({ categoryKey: 'Organisation', actionType: 'site-water',
    content: 'Arroser les pistes pour limiter les poussières.' });
  const water = budgetActionGroup({ categoryKey: 'Organisation', actionType: 'dust-control',
    content: 'Créer des rigoles pour maîtriser le ruissellement.' });
  assert.equal(dust.familyId, 'dust-control');
  assert.equal(water.familyId, 'site-water');
  assert.equal(budgetActionGroup({ categoryKey: 'Organisation', actionType: 'dust-control',
    content: 'Mettre en place les mesures nécessaires.' }).familyId, null);
});

test('cleaning, collection and a combined waste action have distinct cost scopes', () => {
  const grouping = (content: string) => budgetActionGroup({ categoryKey: 'Organisation', actionType: 'waste-management', content }).familyId;
  assert.equal(grouping('Nettoyer et maintenir propre la zone de stockage des déchets.'), 'waste-management');
  assert.equal(grouping('Collecter les déchets dangereux hors du chantier.'), 'waste-disposal');
  assert.equal(grouping('Ranger les déchets dans des bennes puis les évacuer.'), 'waste-complete');
});
