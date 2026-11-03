/** Process-local LRU. Permissions and receipts must be checked before consulting it. */
export class ImageCache<T> {
  private values = new Map<string, { value: T; size: number; expires: number }>();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  constructor(private limit = 64 * 1024 * 1024, private ttl = 5 * 60 * 1000, private now = Date.now) {}
  async read(key: string, load: () => Promise<T>, size: (value: T) => number): Promise<T> {
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key);
      if (cached.expires > this.now()) { this.values.set(key, cached); return cached.value; }
      this.bytes -= cached.size;
    }
    const running = this.pending.get(key);
    if (running) return running;
    const request = Promise.resolve().then(load).then(value => {
      const bytes = size(value);
      if (bytes <= this.limit) {
        for (const [id, entry] of this.values) {
          if (entry.expires <= this.now() || this.bytes + bytes > this.limit) { this.values.delete(id); this.bytes -= entry.size; }
        }
        this.values.set(key, { value, size: bytes, expires: this.now() + this.ttl }); this.bytes += bytes;
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}

/** Bound Drive reads and image conversion without taking the shop's booking lock. */
export class ImageWork {
  private active = 0;
  private queue: (() => void)[] = [];
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try { return await work(); }
    finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
  }
}
