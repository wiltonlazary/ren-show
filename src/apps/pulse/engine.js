// Pulse's synthetic telemetry: a deterministic (seeded) model of one
// production service across four regions and 24 hosts. Every value is a pure
// function of the seed, the simulated time and the incidents started, so the
// history under a chart never changes as it scrolls and two engines with one
// seed agree to the bit. Live readings are smoothed per tick; the log tail is
// a ring of 10,000 lines in typed columns, its text made once per line.

/** The simulated wall clock at time 0: 2026-09-25 13:00:00 UTC. */
export const EPOCH = Date.UTC(2026, 8, 25, 13, 0, 0);

/** @typedef {{ id: string, name: string, share: number, latency: number }} Region */

/** The regions, their share of traffic and their extra network latency (ms). @type {readonly Region[]} */
export const REGIONS = [
  { id: 'north-1', name: 'North', share: 0.36, latency: 0 },
  { id: 'west-1', name: 'West', share: 0.27, latency: 9 },
  { id: 'south-1', name: 'South', share: 0.22, latency: 4 },
  { id: 'east-1', name: 'East', share: 0.15, latency: 27 },
];

/** Short region names, as host names carry them. */
const SHORT = ['nth1', 'wst1', 'sth1', 'est1'];

/** The services behind the gateway. */
export const SERVICES = ['api-gateway', 'checkout', 'payments', 'inventory', 'search', 'auth', 'cart', 'recommendations'];

/** Log levels, lowest first; a level's bit in a filter mask is `1 << level`. */
export const LEVELS = ['debug', 'info', 'warn', 'error'];

/** Every level on. */
export const ALL = 0b1111;

/** The time ranges a chart can show, in milliseconds. */
export const RANGES = /** @type {const} */ ({ '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000 });

/** @typedef {keyof typeof RANGES} Range */

/** The points of a chart over any range. */
export const BUCKETS = 60;

/** Lines the log ring holds. */
export const CAPACITY = 10_000;

/** Requests per second at the peak of the day. */
const PEAK = 2400;

/** How long an incident lasts, in simulated ms. */
export const INCIDENT = 45_000;

/** Deploys roll out every DEPLOY ms (give or take a third). */
const DEPLOY = 11 * 60_000;

/**
 * A 32-bit integer hash of three words (murmur3's finalizer over a mix), as a
 * number in [0, 1).
 * @param {number} a @param {number} b @param {number} c
 */
export function noise(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c ^ 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Noise channels, so readings of one time do not share their jitter. */
const RPS = 1;
const P50 = 2;
const TAIL = 3;
const ERR = 4;
const CPU = 5;
const MEM = 6;
const LOG = 7;
const PICK = 8;

/** @typedef {{ region: number, start: number }} Incident */

/**
 * One reading of the service: totals, percentiles in ms, error rate as a
 * fraction. Fixed shape; the engine reuses its instances.
 */
export class Reading {
  constructor() {
    this.rps = 0;
    this.p50 = 0;
    this.p95 = 0;
    this.p99 = 0;
    this.errors = 0;
  }
}

/** A deploy: when, which service, which version. */
export class Deploy {
  /** @param {number} at @param {string} service @param {string} version @param {number} k */
  constructor(at, service, version, k) {
    this.at = at;
    this.service = service;
    this.version = version;
    this.k = k;
  }
}

/** One host: its name, region and service, and what makes it itself. */
export class Host {
  /** @param {number} i @param {number} seed */
  constructor(i, seed) {
    this.i = i;
    this.region = i % REGIONS.length;
    const n = (i / REGIONS.length) | 0;
    this.service = SERVICES[(n * 3 + this.region) % SERVICES.length];
    this.name = `${this.service.split('-')[0]}-${SHORT[this.region]}-${String(n + 1).padStart(2, '0')}`;
    this.base = 22 + noise(seed, i, 101) * 30;
    this.phase = noise(seed, i, 102) * Math.PI * 2;
    this.period = 40_000 + noise(seed, i, 103) * 80_000;
    this.memory = 38 + noise(seed, i, 104) * 34;
  }
}

/** The whole traffic's share of the day's peak at `t` (a diurnal curve with slower and faster swells). @param {number} t */
function load(t) {
  const day = ((t % 86_400_000) / 86_400_000) * Math.PI * 2;
  return (0.62 + 0.3 * Math.sin(day - 2.2) + 0.08 * Math.sin(day * 3 + 0.7)) * (1 + 0.05 * Math.sin(t / 15_500) + 0.03 * Math.sin(t / 4_900));
}

/** How strongly an incident that started at `start` bites at `t`: a quick ramp, a plateau, a slow recovery. @param {number} t @param {number} start */
function bite(t, start) {
  const d = t - start;
  if (d < 0 || d > INCIDENT) return 0;
  if (d < 4000) return d / 4000;
  if (d < INCIDENT - 12_000) return 1;
  return (INCIDENT - d) / 12_000;
}

/**
 * The ring of log lines: typed columns for what filters read (time, level,
 * region, service), the text once per line, lowercased once for search.
 */
export class Ring {
  constructor(capacity = CAPACITY) {
    this.capacity = capacity;
    this.time = new Float64Array(capacity);
    this.level = new Uint8Array(capacity);
    this.region = new Uint8Array(capacity);
    this.service = new Uint8Array(capacity);
    /** @type {string[]} */
    this.text = new Array(capacity).fill('');
    /** @type {string[]} */
    this.lower = new Array(capacity).fill('');
    /** Lines ever written; the newest is `total - 1`. */
    this.total = 0;
    /** Lines of each level ever written. */
    this.counts = new Float64Array(LEVELS.length);
  }

  /** Lines held (at most the capacity). */
  get size() {
    return Math.min(this.total, this.capacity);
  }

  /** The oldest sequence number still held. */
  get first() {
    return this.total - this.size;
  }

  /** @param {number} time @param {number} level @param {number} region @param {number} service @param {string} text */
  push(time, level, region, service, text) {
    const slot = this.total % this.capacity;
    this.time[slot] = time;
    this.level[slot] = level;
    this.region[slot] = region;
    this.service[slot] = service;
    this.text[slot] = text;
    this.lower[slot] = `${LEVELS[level]} ${REGIONS[region].id} ${SERVICES[service]} ${text}`.toLowerCase();
    this.counts[level]++;
    this.total++;
  }

  /**
   * The sequence numbers of up to `limit` lines at or before `until`, newest
   * first, whose level is in `mask` and whose text holds `query` (lowercase).
   * @param {number} until @param {number} limit @param {number} mask @param {string} query
   * @returns {number[]}
   */
  find(until, limit, mask, query) {
    /** @type {number[]} */
    const out = [];
    const first = this.first;
    const cap = this.capacity;
    for (let seq = Math.min(until, this.total - 1); seq >= first && out.length < limit; seq--) {
      const slot = seq % cap;
      if ((mask & (1 << this.level[slot])) === 0) continue;
      if (query !== '' && !this.lower[slot].includes(query)) continue;
      out.push(seq);
    }
    return out;
  }

  /** Lines at or before `until` that match (for "n of m"). @param {number} until @param {number} mask @param {string} query */
  count(until, mask, query) {
    let n = 0;
    const cap = this.capacity;
    for (let seq = Math.min(until, this.total - 1), first = this.first; seq >= first; seq--) {
      const slot = seq % cap;
      if ((mask & (1 << this.level[slot])) !== 0 && (query === '' || this.lower[slot].includes(query))) n++;
    }
    return n;
  }
}

/** Samples a sparkline keeps. */
export const SAMPLES = 60;
/** Simulated ms between sparkline samples. */
const SAMPLE = 1000;

/** Latency histogram bins: upper bounds in ms (the last is open). */
export const BINS = [10, 20, 30, 40, 50, 60, 80, 100, 130, 160, 200, 250, 320, 400, 500, 650, 800, 1000, 1500, Infinity];

/**
 * The service model and its live state.
 */
export class Engine {
  /** @param {number} [seed] */
  constructor(seed = 7) {
    this.seed = seed | 0;
    /** Simulated time (epoch ms). */
    this.t = EPOCH;
    /** Ticks advanced. */
    this.ticks = 0;
    /** @type {Incident[]} */
    this.incidents = [];
    this.hosts = Array.from({ length: 24 }, (_, i) => new Host(i, this.seed));
    /** Smoothed live readings: the whole service, then each region. */
    this.live = new Reading();
    this.regions = REGIONS.map(() => new Reading());
    /** Live CPU and memory per host, in percent. */
    this.cpu = new Float64Array(this.hosts.length);
    this.memory = new Float64Array(this.hosts.length);
    /** Sparkline rings: requests/s, p99, error rate, mean CPU; `sampled` samples so far. */
    this.sparks = { rps: new Float64Array(SAMPLES), p99: new Float64Array(SAMPLES), errors: new Float64Array(SAMPLES), cpu: new Float64Array(SAMPLES) };
    this.sampled = 0;
    this.nextSample = this.t;
    this.logs = new Ring();
    /** Fractional log lines carried to the next tick. */
    this.carry = 0;
    /** The last deploy logged. */
    this.deployed = Math.floor((this.t - EPOCH) / DEPLOY) - 1;
    this.scratch = new Reading();
    this.part = new Reading();
    // The first reading, with no smoothing lag.
    this.measure(this.t, 0, this.live, this.regions, 1);
    this.hostsAt(this.t, 0, 1);
    this.sample();
  }

  /** The strongest incident biting `region` at `t`. @param {number} t @param {number} region */
  incidentAt(t, region) {
    let most = 0;
    for (const incident of this.incidents) if (incident.region === region) most = Math.max(most, bite(t, incident.start));
    return most;
  }

  /** The region whose incident bites hardest now, or -1. */
  get burning() {
    let region = -1;
    let most = 0;
    for (const incident of this.incidents) {
      const b = bite(this.t, incident.start);
      if (b > most) {
        most = b;
        region = incident.region;
      }
    }
    return region;
  }

  /**
   * Starts an incident in `region` (by default the next one after the last
   * incident's): its error rate and latency spike for INCIDENT ms.
   * @param {number} [region]
   * @returns {number} the region
   */
  incident(region) {
    const last = this.incidents.at(-1);
    const r = region ?? (last === undefined ? 0 : (last.region + 1) % REGIONS.length);
    this.incidents.push({ region: r, start: this.t });
    this.logs.push(this.t, 3, r, 0, `incident: upstream failures in ${REGIONS[r].id}, error budget burning`);
    return r;
  }

  /** How much a deploy that rolled out shortly before `t` raises the tail. @param {number} t */
  deployBump(t) {
    const k = Math.floor((t - EPOCH) / DEPLOY);
    const at = this.deployTime(k);
    const d = at <= t ? t - at : t - this.deployTime(k - 1);
    return d >= 0 && d < 60_000 ? 0.35 * Math.exp(-d / 18_000) : 0;
  }

  /** When deploy `k` rolls out. @param {number} k */
  deployTime(k) {
    return EPOCH + k * DEPLOY + noise(this.seed, k, 200) * (DEPLOY / 3);
  }

  /** @param {number} k */
  deploy(k) {
    const service = SERVICES[Math.floor(noise(this.seed, k, 201) * SERVICES.length)];
    const version = `v2.${(k + 400) % 97}.${Math.floor(noise(this.seed, k, 202) * 9)}`;
    return new Deploy(this.deployTime(k), service, version, k);
  }

  /** The deploys that rolled out in [from, to]. @param {number} from @param {number} to @returns {Deploy[]} */
  deploys(from, to) {
    /** @type {Deploy[]} */
    const out = [];
    for (let k = Math.floor((from - EPOCH) / DEPLOY) - 1, end = Math.floor((to - EPOCH) / DEPLOY); k <= end; k++) {
      const d = this.deploy(k);
      if (d.at >= from && d.at <= to) out.push(d);
    }
    return out;
  }

  /**
   * The model at time `t`, jittered by noise key `n`: each region into
   * `regions` (when given) and the whole service into `into`, each moved a
   * fraction `alpha` of the way from what it held (1 replaces).
   * @param {number} t @param {number} n @param {Reading} into @param {Reading[] | null} regions @param {number} alpha
   */
  measure(t, n, into, regions, alpha) {
    const s = this.seed;
    const l = load(t);
    const bump = this.deployBump(t);
    let rps = 0;
    let p50 = 0;
    let p95 = 0;
    let p99 = 0;
    let bad = 0;
    const part = this.part;
    for (let r = 0; r < REGIONS.length; r++) {
      const region = REGIONS[r];
      const hit = this.incidents.length === 0 ? 0 : this.incidentAt(t, r);
      part.rps = PEAK * region.share * l * (0.95 + 0.1 * noise(s, n, RPS * 16 + r)) * (1 - 0.25 * hit);
      part.p50 = (31 + region.latency + 26 * l + 5 * noise(s, n, P50 * 16 + r)) * (1 + 1.4 * hit);
      part.p95 = part.p50 * (2.2 + 0.35 * noise(s, n, TAIL * 16 + r)) * (1 + bump) * (1 + 1.6 * hit);
      part.p99 = part.p95 * (1.55 + 0.4 * noise(s, n, TAIL * 16 + 8 + r)) * (1 + 1.5 * bump) * (1 + 2.2 * hit);
      part.errors = 0.0018 + 0.0022 * noise(s, n, ERR * 16 + r) + 0.0012 * l + 0.19 * hit + 0.01 * bump;
      if (regions !== null) blend(regions[r], part, alpha);
      rps += part.rps;
      p50 += part.p50 * part.rps;
      p95 += part.p95 * part.rps;
      p99 += part.p99 * part.rps;
      bad += part.errors * part.rps;
    }
    const whole = this.scratch;
    whole.rps = rps;
    whole.p50 = p50 / rps;
    whole.p95 = p95 / rps;
    whole.p99 = p99 / rps;
    whole.errors = bad / rps;
    blend(into, whole, alpha);
  }

  /** Each host's CPU and memory at `t`, moved `alpha` of the way. @param {number} t @param {number} n @param {number} alpha */
  hostsAt(t, n, alpha) {
    const l = load(t);
    const s = this.seed;
    for (const host of this.hosts) {
      const hit = this.incidents.length === 0 ? 0 : this.incidentAt(t, host.region);
      const cpu = clamp(host.base + 34 * (l - 0.62) + 9 * Math.sin(t / host.period + host.phase) + 6 * noise(s, n, CPU * 64 + host.i) + 38 * hit, 1, 99.5);
      const mem = clamp(host.memory + 7 * Math.sin(t / 900_000 + host.phase) + 2 * noise(s, n, MEM * 64 + host.i) + 14 * hit, 5, 99);
      this.cpu[host.i] += (cpu - this.cpu[host.i]) * alpha;
      this.memory[host.i] += (mem - this.memory[host.i]) * alpha;
    }
  }

  /**
   * Advances `ms` of simulated time: live readings (smoothed), hosts,
   * sparkline samples, deploys and log lines.
   * @param {number} ms
   */
  advance(ms) {
    if (!(ms > 0)) return;
    const from = this.t;
    this.t += ms;
    this.ticks++;
    const n = this.ticks;
    // Smoothing by time, not ticks: a 60 Hz and a 20 Hz feed agree.
    const alpha = 1 - Math.exp(-ms / 900);
    this.measure(this.t, n, this.live, this.regions, alpha);
    this.hostsAt(this.t, n, 1 - Math.exp(-ms / 1500));
    while (this.nextSample <= this.t) this.sample();
    // Deploys that rolled out in this step.
    for (let k = this.deployed + 1, end = Math.floor((this.t - EPOCH) / DEPLOY); k <= end; k++) {
      const d = this.deploy(k);
      if (d.at > this.t) break;
      this.deployed = k;
      if (d.at >= from) this.logs.push(d.at, 1, 0, SERVICES.indexOf(d.service), `deploy ${d.service} ${d.version} rolled out (6/6 hosts healthy)`);
    }
    this.lines(from, ms);
  }

  /** Appends a sparkline sample of the live readings. */
  sample() {
    const i = this.sampled % SAMPLES;
    const live = this.live;
    this.sparks.rps[i] = live.rps;
    this.sparks.p99[i] = live.p99;
    this.sparks.errors[i] = live.errors;
    let cpu = 0;
    for (let h = 0; h < this.cpu.length; h++) cpu += this.cpu[h];
    this.sparks.cpu[i] = cpu / this.cpu.length;
    this.sampled++;
    this.nextSample += SAMPLE;
  }

  /** A sparkline's samples, oldest first. @param {'rps' | 'p99' | 'errors' | 'cpu'} name @returns {number[]} */
  spark(name) {
    const ring = this.sparks[name];
    const n = Math.min(this.sampled, SAMPLES);
    /** @type {number[]} */
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = ring[(this.sampled - n + i) % SAMPLES];
    return out;
  }

  /** The log lines of `ms` simulated ms from `from`: about 45 a second at peak, more errors where an incident bites. @param {number} from @param {number} ms */
  lines(from, ms) {
    const live = this.live;
    const burning = this.burning;
    const rate = 45 * load(this.t) + (burning >= 0 ? 60 : 0);
    let count = this.carry + (rate * ms) / 1000;
    const whole = Math.min(Math.floor(count), 400);
    this.carry = count - Math.floor(count);
    const s = this.seed;
    for (let j = 0; j < whole; j++) {
      const seq = this.logs.total;
      const time = from + (ms * (j + 1)) / (whole + 1);
      const roll = noise(s, seq, LOG);
      const pick = noise(s, seq, PICK);
      const region = burning >= 0 && roll < 0.5 ? burning : Math.floor(noise(s, seq, LOG + 16) * REGIONS.length);
      const hot = region === burning;
      const errorShare = hot ? 0.45 : Math.min(0.2, live.errors * 9);
      const level = roll < errorShare ? 3 : roll < errorShare + 0.12 ? 2 : roll < errorShare + 0.3 ? 0 : 1;
      const service = Math.floor(noise(s, seq, LOG + 32) * SERVICES.length);
      this.logs.push(time, level, region, service, message(level, pick, noise(s, seq, LOG + 48), live, hot));
    }
  }

  /**
   * A chart's series over `range` ending now: BUCKETS points, each the model
   * at its bucket's time with that bucket's own jitter (so history stays put
   * as it scrolls), the last one the live reading.
   * @param {number} range
   * @returns {Series}
   */
  series(range) {
    const step = range / BUCKETS;
    const out = new Series(this.t - range + step, step);
    const into = new Reading();
    // Bucket times are aligned to their width: a bucket keeps its value as the window slides.
    const last = Math.floor(this.t / step);
    for (let i = 0; i < BUCKETS - 1; i++) {
      const b = last - (BUCKETS - 1) + i;
      this.measure(b * step, b ^ (step | 0), into, null, 1);
      out.set(i, into, b * step);
    }
    out.set(BUCKETS - 1, this.live, this.t);
    return out;
  }

  /**
   * The share of requests in each latency bin, from a log-normal fitted to
   * the live p50 and p99.
   * @returns {number[]}
   */
  histogram() {
    const mu = Math.log(this.live.p50);
    const sigma = Math.max(0.05, (Math.log(this.live.p99) - mu) / 2.326);
    /** @type {number[]} */
    const out = [];
    let below = 0;
    for (const bound of BINS) {
      const at = bound === Infinity ? 1 : cdf((Math.log(bound) - mu) / sigma);
      out.push(at - below);
      below = at;
    }
    return out;
  }
}

/** A chart's points: times and readings in columns. */
export class Series {
  /** @param {number} start @param {number} step */
  constructor(start, step) {
    this.start = start;
    this.step = step;
    this.time = new Float64Array(BUCKETS);
    this.rps = new Float64Array(BUCKETS);
    this.p50 = new Float64Array(BUCKETS);
    this.p95 = new Float64Array(BUCKETS);
    this.p99 = new Float64Array(BUCKETS);
    this.errors = new Float64Array(BUCKETS);
  }
  /** @param {number} i @param {Reading} r @param {number} time */
  set(i, r, time) {
    this.time[i] = time;
    this.rps[i] = r.rps;
    this.p50[i] = r.p50;
    this.p95[i] = r.p95;
    this.p99[i] = r.p99;
    this.errors[i] = r.errors;
  }
}

/** Moves `into` a fraction `alpha` of the way to `to`. @param {Reading} into @param {Reading} to @param {number} alpha */
function blend(into, to, alpha) {
  into.rps += (to.rps - into.rps) * alpha;
  into.p50 += (to.p50 - into.p50) * alpha;
  into.p95 += (to.p95 - into.p95) * alpha;
  into.p99 += (to.p99 - into.p99) * alpha;
  into.errors += (to.errors - into.errors) * alpha;
}

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** The standard normal CDF (Abramowitz and Stegun 7.1.26). @param {number} z */
function cdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const ENDPOINTS = ['GET /api/v2/products', 'POST /api/v2/checkout', 'GET /api/v2/cart', 'POST /api/v2/payments/authorize', 'GET /api/v2/search?q=', 'POST /api/v2/auth/token', 'GET /api/v2/recommendations', 'PUT /api/v2/cart/items'];
const TABLES = ['orders_by_customer', 'inventory_levels', 'sessions', 'payment_intents', 'catalog_items'];
const TENANTS = ['larkspur', 'copperline', 'tidewell', 'bramblework', 'fernhollow', 'quillby'];
const UPSTREAMS = ['payments.svc:8443', 'inventory.svc:7000', 'search.svc:9200', 'auth.svc:8080'];

/**
 * A log line's text: a template of its level picked by `pick`, filled from
 * `x` and the live readings.
 * @param {number} level @param {number} pick @param {number} x @param {Reading} live @param {boolean} hot
 */
function message(level, pick, x, live, hot) {
  const id = Math.floor(x * 0xffffff).toString(16).padStart(6, '0');
  const ms = Math.round(live.p50 * (0.5 + x * 1.5));
  switch (level) {
    case 0:
      switch (Math.floor(pick * 4)) {
        case 0: return `pool checkout conn=${Math.floor(x * 40)} idle=${Math.floor(60 - x * 40)} wait=${(x * 0.9).toFixed(2)}ms`;
        case 1: return `feature flag new-checkout-flow evaluated to ${x < 0.3 ? 'false' : 'true'} for tenant ${TENANTS[Math.floor(x * TENANTS.length)]}`;
        case 2: return `span exported trace=${id}${id}c0ffee spans=${1 + Math.floor(x * 30)}`;
        default: return `cache get products:catalog:${Math.floor(x * 9000)} hit=${x < 0.92}`;
      }
    case 1:
      switch (Math.floor(pick * 4)) {
        case 0:
        case 1: return `${ENDPOINTS[Math.floor(x * ENDPOINTS.length)]} 200 ${ms}ms`;
        case 2: return `order ord_${id} placed: ${1 + Math.floor(x * 6)} items, total $${(12 + x * 380).toFixed(2)}`;
        default: return `user u_${Math.floor(x * 90000) + 10000} signed in via ${x < 0.5 ? 'sso' : 'passkey'}`;
      }
    case 2:
      switch (Math.floor(pick * 4)) {
        case 0: return `slow query ${Math.round(250 + x * 600)}ms on ${TABLES[Math.floor(x * TABLES.length)]}`;
        case 1: return `retrying payment provider call (attempt ${2 + Math.floor(x * 2)}/3)`;
        case 2: return `rate limit at ${Math.round(75 + x * 24)}% for tenant ${TENANTS[Math.floor(x * TENANTS.length)]}`;
        default: return `GC pause ${Math.round(20 + x * 60)}ms, heap ${Math.round(900 + x * 600)}MB`;
      }
    default:
      if (hot && pick < 0.6) return `upstream connect error or disconnect/reset before headers (${UPSTREAMS[Math.floor(x * UPSTREAMS.length)]})`;
      switch (Math.floor(pick * 4)) {
        case 0: return `${ENDPOINTS[Math.floor(x * ENDPOINTS.length)]} 503 in ${Math.round(live.p99 * (1 + x))}ms`;
        case 1: return `timeout after 2000ms calling ${UPSTREAMS[Math.floor(x * UPSTREAMS.length)]}`;
        case 2: return `circuit breaker OPEN for payments-provider (failures=${5 + Math.floor(x * 20)})`;
        default: return `unhandled rejection in checkout: card_declined (req ${id})`;
      }
  }
}
