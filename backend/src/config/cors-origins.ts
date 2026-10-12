export function corsOrigins(raw: string | undefined, nodeEnv: string | undefined): string | string[] {
  const origins = [...new Set((raw || '').split(',').map((origin) => origin.trim()).filter(Boolean))];

  if (nodeEnv === 'production') {
    if (!origins.length || origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.protocol !== 'https:' || parsed.origin !== origin;
      } catch {
        return true;
      }
    })) {
      throw new Error('CORS_ORIGIN must contain HTTPS origins separated by commas in production');
    }
  }

  return origins.length ? origins : '*';
}
