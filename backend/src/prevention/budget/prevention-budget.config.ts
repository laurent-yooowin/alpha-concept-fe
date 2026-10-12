import { ConfigService } from '@nestjs/config';

export function loadPreventionBudgetContingencyRate(_config: ConfigService): string {
  // Kept for compatibility with stored scenarios and existing callers.
  // A legacy environment variable must never reintroduce a surcharge.
  return '0.00';
}
