import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recommendations = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');
const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
const tooltip = readFileSync(new URL('../src/components/prevention/InfoTooltip.tsx', import.meta.url), 'utf8');

test('recommendations keep the dynamic priority count visible and move explanations to info', () => {
  const section = recommendations.slice(recommendations.indexOf('function FindingList('));
  assert.match(section, /<p className="text-sm text-\[#718096\]">Recommandations consolidées par motif, classées par score décroissant — <strong[^>]*>\{response\.total \?\? 0\} priorité\(s\)<\/strong>\.<\/p>/);
  assert.match(section, /<InfoTooltip label="Détails des recommandations">/);
  assert.match(section, /Un motif peut regrouper plusieurs recommandations\. La gravité décrit le risque ; la priorité dépend du score de traitement\./);
  assert.doesNotMatch(section, /829 priorité/);
});

test('budget shows compact dynamic counts and keeps the full scope in info', () => {
  const header = budget.slice(budget.indexOf('<header className="flex flex-wrap items-start justify-between gap-3">'));
  assert.match(header, /\{reportCount\}\/\{totalReports\} rapport\(s\)/);
  assert.match(header, /\{findingCount\} recommandation\(s\) · \{estimatedCount\} estimation\(s\) IA/);
  assert.match(header, /unpricedCount > 0 \? ` · \$\{unpricedCount\} poste\(s\) à chiffrer`/);
  assert.match(header, /<InfoTooltip label="Détails du périmètre et de la couverture budgétaire">/);
  assert.match(header, /\{categoryFilterLabel\} · \{severityFilterLabel\}/);
  assert.match(header, /Tous les chantiers/);
  assert.match(header, /Toutes les entreprises/);
  assert.match(header, /Les rapports sans recommandation exploitable ne sont pas comptés\. La barre représente la couverture des rapports, pas le montant\./);
  assert.doesNotMatch(header, /76 rapport\(s\) concernés|834 recommandation\(s\)|148 estimation\(s\)/);
});

test('info tooltips open on hover and keyboard focus with an accessible description', () => {
  assert.match(tooltip, /aria-label=\{label\}/);
  assert.match(tooltip, /aria-describedby=\{tooltipId\}/);
  assert.match(tooltip, /role="tooltip"/);
  assert.match(tooltip, /group-hover:visible/);
  assert.match(tooltip, /group-focus-within:visible/);
  assert.match(tooltip, /focus-visible:outline/);
});
