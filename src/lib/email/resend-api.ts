import "server-only";

type ResendRateLimitState = {
  tail: Promise<void>;
  nextStartAt: number;
};

const stateKey = "__spcResendRateLimitState" as const;

function rateLimitState() {
  const scope = globalThis as typeof globalThis & {
    [stateKey]?: ResendRateLimitState;
  };
  scope[stateKey] ??= { tail: Promise.resolve(), nextStartAt: 0 };
  return scope[stateKey];
}

function requestIntervalMs() {
  if (process.env.NODE_ENV === "test") return 0;
  const configured = Number.parseInt(
    process.env.RESEND_API_MAX_REQUESTS_PER_SECOND ?? "8",
    10,
  );
  const requestsPerSecond = Number.isFinite(configured)
    ? Math.min(Math.max(configured, 1), 9)
    : 8;
  return Math.ceil(1_000 / requestsPerSecond);
}

async function reserveRequestSlot() {
  const state = rateLimitState();
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const delay = Math.max(0, state.nextStartAt - Date.now());
  if (delay) await wait(delay);
  state.nextStartAt = Date.now() + requestIntervalMs();
  release();
}

export async function fetchResendApi(url: string, init: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reserveRequestSlot();
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt === 2) return response;
    await wait(retryDelayMs(response.headers.get("retry-after"), attempt));
  }
  throw new Error("Resend zahtev nije završen.");
}

function retryDelayMs(retryAfter: string | null, attempt: number) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_100, seconds * 1_000);
    const date = new Date(retryAfter).getTime();
    if (Number.isFinite(date)) return Math.max(1_100, date - Date.now());
  }
  return 1_100 * (attempt + 1);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
