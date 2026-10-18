// In-memory ring of deleted clip batches (max LIMITS.undoRingSize, each kept LIMITS.undoWindowMs).
// When a batch expires or falls off the ring, `onExpire` runs (deletes the image files for good).
import { LIMITS } from '../../shared/types';
import type { ClipSnapshot } from '../db/clipRepository';

interface Entry {
  at: number;
  snaps: ClipSnapshot[];
}

export class UndoRing {
  private entries: Entry[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onExpire: (snaps: ClipSnapshot[]) => void,
    private readonly size: number = LIMITS.undoRingSize,
    private readonly windowMs: number = LIMITS.undoWindowMs,
    private readonly now: () => number = Date.now,
  ) {}

  push(snaps: ClipSnapshot[]): void {
    if (!snaps.length) return;
    this.entries.push({ at: this.now(), snaps });
    while (this.entries.length > this.size) this.onExpire(this.entries.shift()!.snaps);
    this.schedule();
  }

  /** Pops the most recent batch still inside the undo window. */
  pop(): ClipSnapshot[] | null {
    this.expire();
    return this.entries.pop()?.snaps ?? null;
  }

  get length(): number {
    return this.entries.length;
  }

  expire(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.entries.length && this.entries[0]!.at <= cutoff) this.onExpire(this.entries.shift()!.snaps);
  }

  /** Expires everything (on quit). */
  flush(): void {
    for (const e of this.entries.splice(0)) this.onExpire(e.snaps);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.expire();
      if (this.entries.length) this.schedule();
    }, Math.max(1000, this.windowMs / 4));
    this.timer.unref?.();
  }
}
