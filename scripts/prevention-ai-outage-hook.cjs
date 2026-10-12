'use strict';

// Opt-in local fault injection for the Prevention group LLM request only.
// The marker is short-lived and contains no request or credential data.
const { lstatSync, unlinkSync } = require('node:fs');
const { isAbsolute } = require('node:path');

const marker = process.env.PREVENTION_AI_FAULT_MARKER;
if (marker) {
  if (!isAbsolute(marker)) throw new Error('Prevention AI fault marker must be absolute');
  const targetOrganizationId = process.env.PREVENTION_AI_FAULT_ORGANIZATION_ID;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(targetOrganizationId || '')) {
    throw new Error('Prevention AI fault target organization is required');
  }
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') throw new Error('Prevention AI fault hook requires global fetch');
  const groupPromptPrefix = '{"model":"gpt-5.1","messages":[{"role":"system","content":"Tu es le moteur Prévention du module CSPS.';
  const organizationSymbol = Symbol.for('prevention.group.organizationId');

  globalThis.fetch = function preventionAiFaultFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const configuredUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
    const groupRequest = url === configuredUrl && init?.method === 'POST' &&
      init?.[organizationSymbol] === targetOrganizationId &&
      typeof init.body === 'string' && init.body.startsWith(groupPromptPrefix);
    const forwardedInit = init ? { ...init } : init;
    if (forwardedInit) delete forwardedInit[organizationSymbol];
    if (groupRequest) {
      try {
        const stat = lstatSync(marker);
        const ageMs = Date.now() - stat.mtimeMs;
        if (stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() &&
            (stat.mode & 0o077) === 0 && ageMs >= 0 && ageMs < 120_000) {
          unlinkSync(marker);
          return Promise.reject(new TypeError('fetch failed'));
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return originalFetch.call(this, input, forwardedInit);
  };
}
