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
      context: sanitizeContext(context),
      ts: new Date().toISOString(),
    }),
  );
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function sanitizeContext(context: LogContext) {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (/token|secret|password|authorization/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, value];
    }),
  );
}
