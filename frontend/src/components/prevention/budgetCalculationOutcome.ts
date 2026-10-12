type BudgetOutcomeItem = {
  status?: string;
  aiEstimateDetails?: { kind?: string } | null;
};

export function budgetCalculationOutcome(items: BudgetOutcomeItem[], successMessage: string): string {
  const estimated = items.filter((item) => item.aiEstimateDetails?.kind === 'AI_ESTIMATE').length;
  const unpriced = items.filter((item) => item.status === 'A_CHIFFRER').length;
  if (!unpriced) return `${successMessage} ${estimated} estimation(s) IA.`;
  return `${successMessage} ${estimated} estimation(s) IA ; ${unpriced} poste(s) à classer ou chiffrer manuellement.`;
}
