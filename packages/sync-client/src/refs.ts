/**
 * References from one queued write to the result of an earlier one.
 *
 * Offline, "start cutting" has no session id yet, so "complete cutting" cannot name
 * it. It names the queued start instead — `@ref:<clientOpId>#id` — and the flush
 * fills in the real id once the start has synced. A field path picks deeper values:
 * `block.id`, or `slabs[*].id` for every slab a completion produced.
 */

const REF_PREFIX = "@ref:";
const CLIENT_OP = "[A-Za-z0-9.:_-]+";
const FIELD = "[A-Za-z0-9_.*\\[\\]]+";
const WHOLE = new RegExp(`^@ref:(${CLIENT_OP})#(${FIELD})$`);
const EMBEDDED = new RegExp(`@ref:(${CLIENT_OP})#(${FIELD})`, "g");

export function ref(clientOpId: string, field = "id"): string {
  return `${REF_PREFIX}${clientOpId}#${field}`;
}

export function isRef(value: unknown): value is string {
  return typeof value === "string" && WHOLE.test(value);
}

export class UnresolvedRefError extends Error {
  constructor(
    readonly clientOpId: string,
    readonly field: string,
  ) {
    super(`No value at ${field} in the result of ${clientOpId}`);
  }
}

/** Every earlier write this one depends on. */
export function collectRefs(...values: unknown[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(EMBEDDED)) found.add(match[1]!);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  values.forEach(walk);
  return [...found];
}

/** Read `a.b`, `a[*].b` or `a[0].b` out of a JSON result. */
export function pick(source: unknown, field: string): unknown {
  const parts = field.split(".").flatMap((part) => {
    const m = part.match(/^([^[\]]*)((?:\[[^\]]*\])*)$/);
    if (!m) return [part];
    const out: string[] = [];
    if (m[1]) out.push(m[1]);
    for (const index of m[2]!.matchAll(/\[([^\]]*)\]/g)) out.push(`[${index[1]}]`);
    return out;
  });
  const step = (value: unknown, rest: string[]): unknown => {
    if (rest.length === 0) return value;
    const [head, ...tail] = rest;
    if (head === "[*]") {
      return Array.isArray(value) ? value.map((v) => step(v, tail)) : undefined;
    }
    if (head!.startsWith("[")) {
      const index = Number(head!.slice(1, -1));
      return Array.isArray(value) ? step(value[index], tail) : undefined;
    }
    if (value && typeof value === "object") return step((value as Record<string, unknown>)[head!], tail);
    return undefined;
  };
  return step(source, parts);
}

/**
 * Replace every reference with the value it points at.
 *
 * A string that is only a reference becomes the value itself, so `slabIds:
 * "@ref:x#slabs[*].id"` turns into an array. A reference inside a longer string,
 * such as a URL path, must point at a single id.
 */
export function resolveRefs<T>(value: T, results: (clientOpId: string) => unknown): T {
  const lookup = (clientOpId: string, field: string) => {
    const resolved = pick(results(clientOpId), field);
    const empty = resolved === undefined || resolved === null || (Array.isArray(resolved) && resolved.some((v) => v == null));
    if (empty) throw new UnresolvedRefError(clientOpId, field);
    return resolved;
  };
  const walk = (current: unknown): unknown => {
    if (typeof current === "string") {
      const whole = current.match(WHOLE);
      if (whole) return lookup(whole[1]!, whole[2]!);
      if (!current.includes(REF_PREFIX)) return current;
      return current.replace(EMBEDDED, (_m, op: string, field: string) => {
        const resolved = lookup(op, field);
        if (typeof resolved === "object") throw new UnresolvedRefError(op, field);
        return encodeURIComponent(String(resolved));
      });
    }
    if (Array.isArray(current)) {
      // `[ref("a#slabs[*].id"), "x"]` flattens, so a list can mix queued and known ids.
      return current.flatMap((entry) => {
        const out = walk(entry);
        return isRef(entry) && Array.isArray(out) ? out : [out];
      });
    }
    if (current && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).map(([k, v]) => [k, walk(v)]));
    }
    return current;
  };
  return walk(value) as T;
}

/** What a person reads instead of an invoice number until the server issues one. */
export function pendingRef(clientOpId: string, prefix = "PEND"): string {
  const compact = clientOpId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${prefix}-${compact.slice(0, 6)}`;
}
