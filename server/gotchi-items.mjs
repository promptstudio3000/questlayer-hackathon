import { assert } from "./domain.mjs";
import { readGotchiItemSvg } from "./aavegotchi.mjs";
export function originalInventoryView(data) {
  return {
    ...data,
    gotchis: (data.gotchis || []).map(({ svg, ...item }) => ({
      ...item,
      hasImage: !!svg,
    })),
  };
}

export function linkedItemId(link, value, now = Date.now()) {
  assert(
    typeof value === "string" &&
      /^[1-9]\d{0,4}$/.test(value) &&
      Number(value) <= 65535,
    "Invalid original item.",
    400,
  );
  assert(
    link && link.verified_at > now - 300000,
    "Refresh original ownership to view these items.",
    403,
  );
  const data = JSON.parse(link.data);
  assert(
    data.wearables?.some(
      (item) => item.itemId === value && /^[1-9]\d{0,77}$/.test(item.quantity),
    ),
    "This item is not in your verified original inventory.",
    403,
  );
  return value;
}

// Public artwork is shared, but every HTTP request must first validate its owner's snapshot.
export class GotchiItemArt {
  constructor({ read = readGotchiItemSvg, clock = Date.now } = {}) {
    this.read = read;
    this.clock = clock;
    this.cache = new Map();
    this.pending = new Map();
    this.queue = [];
    this.active = 0;
    this.bytes = 0;
  }
  get(id) {
    const entry = this.cache.get(id);
    if (entry && entry.until > this.clock()) return Promise.resolve(entry.svg);
    if (this.pending.has(id)) return this.pending.get(id);
    assert(
      this.pending.size < 24,
      "Original item previews are busy. Please try again.",
      503,
    );
    const task = new Promise((resolve, reject) =>
      this.queue.push({ id, resolve, reject }),
    );
    this.pending.set(id, task);
    this.drain();
    return task;
  }
  drain() {
    while (this.active < 4 && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(() => this.read(job.id))
        .then((value) => {
          assert(
            typeof value === "string" &&
              /^<svg\b/.test(value) &&
              Buffer.byteLength(value) <= 200000,
            "This original item preview is unavailable.",
            503,
          );
          const svg = Buffer.from(value);
          for (const [key, entry] of this.cache)
            if (entry.until <= this.clock()) {
              this.bytes -= entry.svg.length;
              this.cache.delete(key);
            }
          if (this.cache.has(job.id)) {
            this.bytes -= this.cache.get(job.id).svg.length;
            this.cache.delete(job.id);
          }
          while (
            this.cache.size >= 64 ||
            this.bytes + svg.length > 2 * 1024 * 1024
          ) {
            const key = this.cache.keys().next().value;
            this.bytes -= this.cache.get(key).svg.length;
            this.cache.delete(key);
          }
          this.cache.set(job.id, { svg, until: this.clock() + 3600000 });
          this.bytes += svg.length;
          job.resolve(svg);
        })
        .catch(job.reject)
        .finally(() => {
          this.pending.delete(job.id);
          this.active--;
          this.drain();
        });
    }
  }
}
