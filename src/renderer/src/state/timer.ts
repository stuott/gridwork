/**
 * Pausable solving timer (design.md section 6.3). Counts elapsed seconds,
 * not wall-clock start/end times, so it can be seeded from saved progress
 * (state/persistence.ts) and resume exactly where it left off.
 */
export class Timer {
  private seconds: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onTick: (seconds: number) => void;

  constructor(onTick: (seconds: number) => void, initialSeconds = 0) {
    this.seconds = initialSeconds;
    this.onTick = onTick;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => {
      this.seconds += 1;
      this.onTick(this.seconds);
    }, 1000);
  }

  pause(): void {
    if (this.intervalId === null) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  toggle(): void {
    if (this.isRunning()) this.pause();
    else this.start();
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  getSeconds(): number {
    return this.seconds;
  }

  /** Seeds the timer at a specific elapsed-seconds value (e.g. resuming saved progress) without starting it. */
  setSeconds(seconds: number): void {
    this.seconds = seconds;
    this.onTick(this.seconds);
  }


  destroy(): void {
    this.pause();
  }
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}
