import { describe, it, expect } from "vitest";
import { globToRegex, matchFault, type FaultRule } from "./faults";

describe("globToRegex", () => {
  it("treats * as a single path segment matcher", () => {
    const re = globToRegex("/api/conversations/*/messages");
    expect(re.test("/api/conversations/abc/messages")).toBe(true);
    expect(re.test("/api/conversations/abc-123/messages")).toBe(true);
    // Should not span slashes
    expect(re.test("/api/conversations/abc/extra/messages")).toBe(false);
  });

  it("escapes regex metacharacters in literal segments", () => {
    const re = globToRegex("/api/v1.0/health");
    expect(re.test("/api/v1.0/health")).toBe(true);
    expect(re.test("/api/v1X0/health")).toBe(false);
  });

  it("anchors at both ends", () => {
    const re = globToRegex("/health");
    expect(re.test("/health")).toBe(true);
    expect(re.test("/healthz")).toBe(false);
    expect(re.test("/api/health")).toBe(false);
  });
});

describe("matchFault", () => {
  it("returns null when no rule matches", () => {
    const store: FaultRule[] = [{ path: "/foo", status: 500, count: 1 }];
    expect(matchFault("/bar", "GET", store)).toBeNull();
  });

  it("matches by path and method (case-insensitive)", () => {
    const store: FaultRule[] = [
      { path: "/api/x", method: "POST", status: 503, count: 1 },
    ];
    expect(matchFault("/api/x", "post", store)?.status).toBe(503);
    // Wrong method should not match
    expect(matchFault("/api/x", "GET", store)).toBeNull();
  });

  it("matches any method when rule.method is omitted", () => {
    const store: FaultRule[] = [{ path: "/api/x", status: 403, count: 1 }];
    expect(matchFault("/api/x", "GET", store)?.status).toBe(403);
  });

  it("decrements count on each match and evicts at zero", () => {
    const store: FaultRule[] = [{ path: "/api/x", status: 500, count: 2 }];
    expect(matchFault("/api/x", "GET", store)?.status).toBe(500);
    expect(store[0].count).toBe(1);
    expect(matchFault("/api/x", "GET", store)?.status).toBe(500);
    expect(store).toHaveLength(0);
    expect(matchFault("/api/x", "GET", store)).toBeNull();
  });

  it("sticky rules (count = -1) keep matching indefinitely", () => {
    const store: FaultRule[] = [{ path: "/api/x", status: 503, count: -1 }];
    for (let i = 0; i < 10; i++) {
      expect(matchFault("/api/x", "GET", store)?.status).toBe(503);
    }
    expect(store).toHaveLength(1);
  });

  it("returns the first matching rule when multiple match", () => {
    const store: FaultRule[] = [
      { path: "/api/*", status: 503, count: -1 },
      { path: "/api/x", status: 403, count: -1 },
    ];
    expect(matchFault("/api/x", "GET", store)?.status).toBe(503);
  });
});
