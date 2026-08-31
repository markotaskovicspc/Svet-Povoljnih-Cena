const TRANSIENT_DATABASE_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P2024",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

export function isTransientDatabaseConnectionError(error: unknown) {
  const code = errorCode(error);
  if (code && TRANSIENT_DATABASE_CODES.has(code)) return true;

  const message = errorMessage(error).toLowerCase();
  return [
    "timeout exceeded when trying to connect",
    "timed out fetching a new connection from the connection pool",
    "connection terminated unexpectedly",
    "connection timeout",
    "connection reset",
    "can't reach database server",
    "too many clients",
    "remaining connection slots are reserved",
  ].some((fragment) => message.includes(fragment));
}

export async function retryTransientDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: (attempt: number) => number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? ((attempt) => 500 * attempt);
  const wait = options.wait ?? delay;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt === attempts ||
        !isTransientDatabaseConnectionError(error)
      ) {
        throw error;
      }
      await wait(Math.max(0, delayMs(attempt)));
    }
  }

  throw new Error("Operacija baze nije završena.");
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
