// Fault-injection registry used by the dev-agent Vite plugin to simulate
// error responses without standing up a broken backend. Kept in a vite-free
// module so the matching logic is unit-testable in any environment.

export type FaultRule = {
  // Glob-style path match. `*` matches one path segment (no `/`).
  // e.g. "/api/conversations/*/messages" matches POST /api/conversations/abc/messages
  path: string;
  // Optional HTTP method filter. Case-insensitive. Omit to match any.
  method?: string;
  // Status to return.
  status: number;
  // Optional response body. Defaults to a small marker object.
  body?: unknown;
  // Remaining uses; -1 = sticky (never decremented).
  count: number;
};

export const faults: FaultRule[] = [];

export function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

// matchFault returns the first matching rule and applies its lifecycle:
// non-sticky counts are decremented and the rule is evicted at zero.
export function matchFault(
  pathOnly: string,
  method: string,
  store: FaultRule[] = faults,
): FaultRule | null {
  for (let i = 0; i < store.length; i++) {
    const rule = store[i];
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue;
    if (!globToRegex(rule.path).test(pathOnly)) continue;
    if (rule.count === 0) continue;
    if (rule.count > 0) rule.count--;
    if (rule.count === 0) store.splice(i, 1);
    return rule;
  }
  return null;
}
