export interface TrackingServiceAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Serializes repeated React lifecycle requests into one native service state. */
export class RideTrackingController {
  private active = false;

  constructor(private readonly service: TrackingServiceAdapter) {}

  async ensureStarted(): Promise<void> {
    if (this.active) return;
    await this.service.start();
    this.active = true;
  }

  async ensureStopped(): Promise<void> {
    if (!this.active) return;
    await this.service.stop();
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
