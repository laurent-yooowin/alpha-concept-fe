import { createHash } from 'crypto';

/** Only technical diagnostics may enter persistent logs; never copy a provider
 * response, a prompt or an arbitrary persisted error message into them. */
export function preventionFailureDiagnostic(error: unknown): Record<string, string | number> {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const message = typeof error === 'string' ? error : typeof value?.message === 'string' ? value.message : '';
  const known: Array<[RegExp, string]> = [
    [/invalid recommendation risk vector/i, 'AI_INVALID_RECOMMENDATION_RISK_VECTOR'],
    [/invalid observation risk vector/i, 'AI_INVALID_OBSERVATION_RISK_VECTOR'],
    [/invalid phase metadata/i, 'AI_INVALID_PHASE_METADATA'],
    [/Prevention LLM returned an invalid .* confidence/i, 'AI_INVALID_CONFIDENCE'],
    [/Prevention LLM returned invalid JSON/i, 'AI_INVALID_JSON'],
    [/Prevention LLM returned no content/i, 'AI_EMPTY_RESPONSE'],
    [/Prevention LLM request failed/i, 'AI_UPSTREAM_REQUEST_FAILED'],
    [/OPENAI_API_KEY is not configured/i, 'AI_CONFIGURATION_MISSING'],
    [/operation was aborted|aborterror|timed?\s*out/i, 'UPSTREAM_REQUEST_ABORTED'],
    [/prevention source changed/i, 'PREVENTION_SOURCE_CHANGED'],
    [/prevention source disappeared/i, 'PREVENTION_SOURCE_DISAPPEARED'],
    [/invalid persisted visit photos/i, 'INVALID_VISIT_PHOTOS'],
    [/too many (entries|groups)/i, 'PREVENTION_VOLUME_LIMIT'],
  ];
  const persistedCode = /^(?:PREVENTION|GROUP|BUDGET|ORG|EXTRACTION|RECOVERY)_[A-Z0-9_]{2,72}$/.test(message) ? message : null;
  const providerCode = typeof value?.code === 'string' &&
    /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ER_[A-Z0-9_]{2,60})$/.test(value.code)
    ? value.code : null;
  const code = persistedCode ?? known.find(([pattern]) => pattern.test(message))?.[1] ??
    providerCode ?? 'UNCLASSIFIED_WORKER_ERROR';
  const name = typeof value?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.name)
    ? value.name : 'Error';
  const status = typeof value?.status === 'number' ? value.status :
    /^Prevention LLM request failed \((\d{3})\)$/.test(message) ? Number(message.match(/\((\d{3})\)$/)?.[1]) : NaN;
  const vectorReason = typeof value?.vectorReason === 'string' &&
    ['NOT_ARRAY', 'COUNT_MISMATCH', 'INDEX_MISMATCH', 'RISK_LEVEL_INVALID'].includes(value.vectorReason)
    ? value.vectorReason : null;
  const vectorExpectedCount = typeof value?.vectorExpectedCount === 'number' &&
    Number.isInteger(value.vectorExpectedCount) && value.vectorExpectedCount >= 0 && value.vectorExpectedCount <= 100
    ? value.vectorExpectedCount : null;
  const vectorActualCount = typeof value?.vectorActualCount === 'number' &&
    Number.isInteger(value.vectorActualCount) && value.vectorActualCount >= 0 && value.vectorActualCount <= 1000
    ? value.vectorActualCount : null;
  return {
    errorCode: code,
    errorName: name,
    ...(vectorReason && vectorExpectedCount !== null ? { vectorReason, vectorExpectedCount } : {}),
    ...(vectorActualCount !== null ? { vectorActualCount } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { upstreamStatus: status } : {}),
    ...(message ? { errorFingerprint: createHash('sha256').update(message).digest('hex').slice(0, 16) } : {}),
  };
}
