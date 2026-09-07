/** A scheduled wait is not a failed delivery attempt. */
export class BackgroundJobDeferredError extends Error {
  constructor(public readonly availableAt: Date) {
    super(`Posao je zakazan za ${availableAt.toISOString()}.`);
    this.name = "BackgroundJobDeferredError";
  }
}
