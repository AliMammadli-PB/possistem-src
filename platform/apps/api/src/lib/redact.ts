const SECRET_KEYS = /password|token|secret|authorization|cookie|hmac|pepper|key|signature/i;

export function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 32)}…[truncated]`;
  return value;
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactObject(v as Record<string, unknown>);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

export function createRedactingLoggerOpts(level: string) {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.activationKey',
        'req.body.data', 'req.body.signature', 'req.body.card_id', 'req.body.token',
        'req.query.handoff',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
  };
}
