// Typed errors and a small fetch wrapper for the playground.
//
// The web adapter returns distinct HTTP statuses (401, 403, 503, 5xx)
// that the UI needs to surface differently. Centralising the mapping here
// keeps call sites free of status-code logic.

export class ApiError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class AuthRequiredError extends ApiError {
  constructor(body?: unknown) {
    super("Authentication required", 401, body);
    this.name = "AuthRequiredError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(body?: unknown) {
    super("Forbidden", 403, body);
    this.name = "ForbiddenError";
  }
}

export class UnavailableError extends ApiError {
  constructor(body?: unknown) {
    super("Service unavailable", 503, body);
    this.name = "UnavailableError";
  }
}

export class ServerError extends ApiError {
  constructor(status: number, body?: unknown) {
    super("Server error", status, body);
    this.name = "ServerError";
  }
}

export class ClientError extends ApiError {
  constructor(status: number, body?: unknown) {
    super("Client error", status, body);
    this.name = "ClientError";
  }
}

export class NetworkError extends ApiError {
  constructor(cause?: unknown) {
    super("Network error", undefined, cause);
    this.name = "NetworkError";
  }
}

type RequestOptions = RequestInit & {
  // When true, returns null for 404 instead of throwing ClientError.
  // Used for endpoints where "not found" is a normal outcome (e.g. optional config).
  nullOn404?: boolean;
};

// request executes a fetch and maps the outcome to a typed result.
// On non-2xx, throws one of the typed errors above. Body parsing is best-effort:
// JSON when Content-Type is application/json, otherwise text. T is the parsed
// JSON body shape on success.
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {},
): Promise<T | null> {
  const { nullOn404, ...init } = options;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    throw new NetworkError(cause);
  }

  if (res.ok) {
    if (res.status === 204) return null;
    return parseBody<T>(res);
  }

  const body = await parseBody<unknown>(res).catch(() => undefined);

  switch (res.status) {
    case 401:
      throw new AuthRequiredError(body);
    case 403:
      throw new ForbiddenError(body);
    case 404:
      if (nullOn404) return null;
      throw new ClientError(404, body);
    case 503:
      throw new UnavailableError(body);
    default:
      if (res.status >= 500) throw new ServerError(res.status, body);
      throw new ClientError(res.status, body);
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

// userMessageForError maps a thrown error from request() (or anywhere else)
// to a short, user-facing string suitable for an inline banner. Unknown
// errors fall through to a generic message rather than leaking the raw text.
export function userMessageForError(err: unknown): string {
  if (err instanceof AuthRequiredError) return "Please sign in again to continue.";
  if (err instanceof ForbiddenError) return "You're not authorized to use this app.";
  if (err instanceof UnavailableError) return "Service is temporarily unavailable. Please try again in a moment.";
  if (err instanceof ServerError) return "Something went wrong on the server. Please try again.";
  if (err instanceof NetworkError) return "Can't reach the server. Check your connection.";
  if (err instanceof ClientError) return "Request failed. Please try again.";
  return "Something went wrong. Please try again.";
}
