import "server-only";

type LogContext = Record<string, unknown>;

export function logOperationalError(
  event: string,
  error: unknown,
  context: LogContext = {},
) {
  console.error(
    `[ops] ${event}`,
    JSON.stringify({
      level: "error",
      event,
      error: normalizeError(error),
      context: sanitizeValue(context),
      ts: new Date().toISOString(),
    }),
  );
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactText(error.message),
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    };
  }

  return { message: redactText(String(error)) };
}

export function redactText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone]")
    .replace(/(bearer|token|secret|password|authorization)(\s*[:=]\s*|\s+)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, 1000);
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (/token|secret|password|authorization|cookie|email|phone|address/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, sanitizeValue(nestedValue, nestedKey)]));
  }
  return value;
}
