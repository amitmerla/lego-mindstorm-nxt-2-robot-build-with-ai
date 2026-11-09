// Cursor-style "behind the scenes" log stream.
const listeners = new Set();
const entries = [];
const t0 = performance.now();

export function log(tag, msg, ms) {
  const e = { tag, msg: String(msg), ms, at: (performance.now() - t0) / 1000 };
  entries.push(e);
  if (entries.length > 500) entries.shift();
  listeners.forEach((fn) => fn(e));
  // eslint-disable-next-line no-console
  console.debug(`[${tag}]`, msg);
}

export function onLog(fn) {
  entries.forEach(fn);
  listeners.add(fn);
}

export function clearLog() {
  entries.length = 0;
}

// Time an async step and log it with its duration.
export async function timed(tag, label, fn) {
  const start = performance.now();
  log(tag, `${label} …`);
  try {
    const r = await fn();
    log(tag, `${label} ✓`, performance.now() - start);
    return r;
  } catch (err) {
    log('error', `${label} ✗ ${err?.message || err}`, performance.now() - start);
    throw err;
  }
}
