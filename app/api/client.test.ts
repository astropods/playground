import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  request,
  userMessageForError,
  AuthRequiredError,
  ForbiddenError,
  UnavailableError,
  ServerError,
  ClientError,
  NetworkError,
} from "./client";

function mockResponse(
  init: { status?: number; body?: unknown; contentType?: string } = {},
): Response {
  const { status = 200, body, contentType = "application/json" } = init;
  const headers = new Headers({ "content-type": contentType });
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return new Response(text, { status, headers });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("request — success", () => {
  it("returns parsed JSON on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ body: { x: 1 } })));
    await expect(request<{ x: number }>("/foo")).resolves.toEqual({ x: 1 });
  });

  it("returns text on 200 when content-type is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse({ body: "hello", contentType: "text/plain" })),
    );
    await expect(request<string>("/foo")).resolves.toBe("hello");
  });

  it("returns null on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(request("/foo")).resolves.toBeNull();
  });
});

describe("request — typed error mapping", () => {
  it("401 → AuthRequiredError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 401 })));
    await expect(request("/foo")).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("403 → ForbiddenError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 403 })));
    await expect(request("/foo")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("503 → UnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 503 })));
    await expect(request("/foo")).rejects.toBeInstanceOf(UnavailableError);
  });

  it("500 → ServerError carrying status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 500 })));
    await expect(request("/foo")).rejects.toMatchObject({
      name: "ServerError",
      status: 500,
    });
  });

  it("502 → ServerError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 502 })));
    await expect(request("/foo")).rejects.toBeInstanceOf(ServerError);
  });

  it("400 → ClientError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 400 })));
    await expect(request("/foo")).rejects.toBeInstanceOf(ClientError);
  });

  it("404 by default → ClientError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 404 })));
    await expect(request("/foo")).rejects.toBeInstanceOf(ClientError);
  });

  it("404 with nullOn404 → null (no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ status: 404 })));
    await expect(request("/foo", { nullOn404: true })).resolves.toBeNull();
  });
});

describe("request — network failure", () => {
  it("fetch rejection → NetworkError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/foo")).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("userMessageForError", () => {
  it("maps each typed error to a distinct user message", () => {
    const msgs = new Set([
      userMessageForError(new AuthRequiredError()),
      userMessageForError(new ForbiddenError()),
      userMessageForError(new UnavailableError()),
      userMessageForError(new ServerError(500)),
      userMessageForError(new ClientError(400)),
      userMessageForError(new NetworkError()),
    ]);
    expect(msgs.size).toBe(6);
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(userMessageForError(new Error("internal stack trace"))).not.toContain(
      "internal stack trace",
    );
    expect(userMessageForError(undefined)).toBeTruthy();
  });
});

describe("request — error body parsing is best-effort", () => {
  it("attaches parsed JSON body on error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse({ status: 403, body: { reason: "denied" } })),
    );
    await expect(request("/foo")).rejects.toMatchObject({
      name: "ForbiddenError",
      body: { reason: "denied" },
    });
  });

  it("does not throw if body cannot be parsed", async () => {
    // Server says JSON but body is malformed — the typed error must still surface.
    const bad = new Response("not-json", {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bad));
    await expect(request("/foo")).rejects.toBeInstanceOf(ServerError);
  });
});
