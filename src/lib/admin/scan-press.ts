/** A held trigger can deliver one result; releasing is required to re-arm it. */
export class ScanPress {
  private held = false;
  private delivered = false;
  get active() { return this.held && !this.delivered; }
  begin() { if (!this.held) { this.held = true; this.delivered = false; } }
  release() { this.held = false; }
  accept() { if (!this.active) return false; this.delivered = true; return true; }
}
