import { createHash } from 'crypto';

export const UNASSIGNED_BUDGET_CLIENT_KEY = 'unassigned';
export const UNASSIGNED_BUDGET_CLIENT_LABEL = 'Client non renseigné';

export function budgetClientIdentity(value: unknown): { key: string; label: string } {
  const label = typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
  if (!label) return { key: UNASSIGNED_BUDGET_CLIENT_KEY, label: UNASSIGNED_BUDGET_CLIENT_LABEL };
  const normalized = label.toLocaleLowerCase('fr-FR');
  return { key: createHash('sha256').update(normalized).digest('hex'), label: label.slice(0, 255) };
}

export function budgetClientActionKey(clientKey: string, actionKey: string): string {
  return createHash('sha256').update(`budget-client-action-v1|${clientKey}|${actionKey}`).digest('hex');
}

export function parseBudgetClientKeys(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  const parsed = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(parsed) || parsed.length > 50 || parsed.some((key) =>
    typeof key !== 'string' || (key !== UNASSIGNED_BUDGET_CLIENT_KEY && !/^[0-9a-f]{64}$/.test(key)))) {
    throw new Error('Invalid budget client selection');
  }
  return [...new Set(parsed)].sort();
}

export function storedBudgetClientKeys(value: unknown): string[] {
  if (typeof value === 'string' && value.startsWith('[')) {
    try { return parseBudgetClientKeys(JSON.parse(value)); }
    catch { throw new Error('Invalid stored budget client selection'); }
  }
  return parseBudgetClientKeys(value);
}
