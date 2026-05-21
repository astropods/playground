import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { MockEventSource } from "./test/setup";

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Per-endpoint result. `ok` keeps the old shape for cheap success/failure;
// `status` lets a test simulate a specific HTTP code (e.g. 403 for forbidden).
type EndpointResult = { ok: boolean; status?: number; body?: unknown };

function mockFetch(overrides?: {
  health?: EndpointResult;
  config?: object | null;
  configError?: number;
  conversations?: EndpointResult;
  messages?: EndpointResult;
}) {
  const health = overrides?.health ?? { ok: true };
  const config =
    overrides && "config" in overrides
      ? overrides.config
      : {
          systemPrompt: "You are a helpful assistant.",
          tools: [{ name: "search", title: "Search", description: "Search the web", type: "other" }],
        };
  const configError = overrides?.configError;
  const conversations = overrides?.conversations ?? { ok: true };
  const messages = overrides?.messages ?? { ok: true };

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) {
        if (!health.ok && health.status === undefined)
          return Promise.reject(new Error("Network error"));
        return Promise.resolve(jsonResponse({ status: "ok" }, health.status ?? 200));
      }
      if (url.endsWith("/api/agent/config")) {
        if (configError !== undefined) return Promise.resolve(jsonResponse({}, configError));
        if (config === null) return Promise.resolve(jsonResponse(null, 404));
        return Promise.resolve(jsonResponse(config));
      }
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        if (!conversations.ok && conversations.status === undefined)
          return Promise.reject(new Error("Failed to create conversation"));
        if (!conversations.ok)
          return Promise.resolve(jsonResponse(conversations.body ?? {}, conversations.status));
        return Promise.resolve(jsonResponse({ conversation_id: "test-conv-123" }));
      }
      if (url.includes("/api/conversations/") && url.endsWith("/messages") && init?.method === "POST") {
        if (!messages.ok && messages.status === undefined)
          return Promise.reject(new Error("Failed to send message"));
        if (!messages.ok)
          return Promise.resolve(jsonResponse(messages.body ?? {}, messages.status));
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(jsonResponse({}));
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  MockEventSource.latest = null;
});

// ---------------------------------------------------------------------------
// Connection error
// ---------------------------------------------------------------------------
describe("Connection error", () => {
  it("renders error state when /health fails", async () => {
    mockFetch({ health: { ok: false } });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Connection Error")).toBeInTheDocument();
    });
  });

  it("retry button re-checks connection", async () => {
    const user = userEvent.setup();
    mockFetch({ health: { ok: false } });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Connection Error")).toBeInTheDocument();
    });

    // Now make health succeed
    mockFetch({ health: { ok: true } });

    await user.click(screen.getByText("Retry Connection"));

    await waitFor(() => {
      expect(screen.queryByText("Connection Error")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe("Empty state", () => {
  it("shows 'Agent Playground' heading and prompt text", async () => {
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Send a message below to start a conversation/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
describe("Header", () => {
  it("renders logo images, ViewToggle, and ThemeToggle", async () => {
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    // Logos (there are two in the header + two in EmptyState)
    const logos = screen.getAllByAltText("Astro");
    expect(logos.length).toBeGreaterThanOrEqual(2);

    // ViewToggle buttons
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();

    // ThemeToggle
    expect(
      screen.getByTitle(/Switch to dark mode|Switch to light mode/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ViewToggle
// ---------------------------------------------------------------------------
describe("ViewToggle", () => {
  it("Chat is active by default; clicking Config switches view", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    // Chat view is showing (empty state visible)
    expect(screen.getByText("Agent Playground")).toBeInTheDocument();

    // Switch to Config
    await user.click(screen.getByText("Config"));

    await waitFor(() => {
      expect(screen.getByText("System Prompt")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// ThemeToggle
// ---------------------------------------------------------------------------
describe("ThemeToggle", () => {
  it("toggles .dark class on <html>", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    const toggle = screen.getByTitle(/Switch to dark mode|Switch to light mode/);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chat input
// ---------------------------------------------------------------------------
describe("Chat input", () => {
  it("textarea is present and submit is disabled when empty", async () => {
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Send a message...");
    expect(textarea).toBeInTheDocument();

    // Submit button should be disabled when input is empty
    const submitButton = textarea
      .closest("form")!
      .querySelector('button[type="submit"]')!;
    expect(submitButton).toBeDisabled();
  });

  it("submit button enables when text is entered", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, "Hello");

    const submitButton = textarea
      .closest("form")!
      .querySelector('button[type="submit"]')!;
    expect(submitButton).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Helpers for chat tests
// ---------------------------------------------------------------------------

/** Render app, wait for ready state, type a message and submit it. */
async function renderAndSendMessage(text = "Hello agent") {
  const user = userEvent.setup();
  mockFetch();
  render(<App />);

  await waitFor(() => {
    expect(screen.getByText("Agent Playground")).toBeInTheDocument();
  });

  const textarea = screen.getByPlaceholderText("Send a message...");
  await user.type(textarea, text);
  await user.click(
    textarea.closest("form")!.querySelector('button[type="submit"]')!,
  );

  // Wait for conversation creation + EventSource to be set up
  await waitFor(() => {
    expect(MockEventSource.latest).not.toBeNull();
  });

  return { user, es: MockEventSource.latest! };
}

// ---------------------------------------------------------------------------
// Config view content
// ---------------------------------------------------------------------------
describe("Config view content", () => {
  it("renders system prompt and tool info from fetched config", async () => {
    const user = userEvent.setup();
    mockFetch({
      config: {
        systemPrompt: "You are a helpful assistant.",
        tools: [
          { name: "search", title: "Search", description: "Search the web", type: "other" },
          { name: "calc", title: "Calculator", description: "Do math", type: "other" },
        ],
      },
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Config"));

    await waitFor(() => {
      expect(screen.getByText("System Prompt")).toBeInTheDocument();
    });

    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Search the web")).toBeInTheDocument();
    expect(screen.getByText("Calculator")).toBeInTheDocument();
    expect(screen.getByText("Do math")).toBeInTheDocument();
    expect(screen.getByText("2 tools")).toBeInTheDocument();
  });

  it("shows fallback when config fetch fails", async () => {
    const user = userEvent.setup();
    mockFetch({ config: null });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Config"));

    await waitFor(() => {
      expect(screen.getByText("No configuration available")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Chat message sending
// ---------------------------------------------------------------------------
describe("Chat message sending", () => {
  it("sends correct API requests on submit", async () => {
    await renderAndSendMessage("Hello agent");

    const fetchMock = vi.mocked(globalThis.fetch);
    const calls = fetchMock.mock.calls;

    // Find the POST /api/conversations call
    const createCall = calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.endsWith("/api/conversations") &&
        init?.method === "POST",
    );
    expect(createCall).toBeDefined();

    // Find the POST .../messages call and verify the body
    const msgCall = calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/api/conversations/test-conv-123/messages") &&
        init?.method === "POST",
    );
    expect(msgCall).toBeDefined();
    const body = JSON.parse(msgCall![1]!.body as string);
    expect(body.content).toBe("Hello agent");
  });

  it("user message appears immediately and input clears", async () => {
    await renderAndSendMessage("Hello agent");

    // User message visible
    expect(screen.getByText("Hello agent")).toBeInTheDocument();

    // Input cleared
    const textarea = screen.getByPlaceholderText("Send a message...");
    expect(textarea).toHaveValue("");
  });

  it("submit button is disabled while waiting for response", async () => {
    await renderAndSendMessage("Hello agent");

    const textarea = screen.getByPlaceholderText("Send a message...");
    const submitButton = textarea
      .closest("form")!
      .querySelector('button[type="submit"]')!;
    expect(submitButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// SSE streaming events
// ---------------------------------------------------------------------------
describe("SSE streaming events", () => {
  it("chunk events append text to assistant message", async () => {
    const { es } = await renderAndSendMessage("Hi");

    act(() => {
      es.simulateEvent("chunk", { type: "chunk", content: "Hello " });
    });
    act(() => {
      es.simulateEvent("chunk", { type: "chunk", content: "world!" });
    });

    // Streamdown splits animated text per word, so each word lives in its own
    // <span>. Match against the surrounding paragraph's normalized textContent
    // so the assertion is robust to that split.
    await waitFor(() => {
      const para = Array.from(document.querySelectorAll("p")).find(
        (p) => p.textContent?.replace(/\s+/g, " ").trim() === "Hello world!",
      );
      expect(para).toBeTruthy();
    });
  });

  it("step-start and step-end render step indicators", async () => {
    const { es } = await renderAndSendMessage("Use a tool");

    act(() => {
      es.simulateEvent("step-start", {
        type: "step-start",
        step_id: "s1",
        name: "web_search",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });

    act(() => {
      es.simulateEvent("step-end", { type: "step-end", step_id: "s1" });
    });

    // Step is still visible (now with completed status — the Check icon is rendered)
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });
  });

  it("finish event stops streaming and re-enables input", async () => {
    const { es } = await renderAndSendMessage("Hi");

    act(() => {
      es.simulateEvent("chunk", { type: "chunk", content: "Done" });
    });
    act(() => {
      es.simulateEvent("finish", { type: "finish" });
    });

    await waitFor(() => {
      expect(screen.getByText("Done")).toBeInTheDocument();
    });

    // Textarea should be re-enabled
    const textarea = screen.getByPlaceholderText("Send a message...");
    expect(textarea).not.toBeDisabled();
  });

  it("error SSE event shows error text in assistant message", async () => {
    const { es } = await renderAndSendMessage("Hi");

    act(() => {
      es.simulateEvent("error", {
        type: "error",
        message: "Rate limit exceeded",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Error: Rate limit exceeded")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
describe("Keyboard shortcuts", () => {
  it("Enter submits the form", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, "keyboard submit");
    await user.keyboard("{Enter}");

    // Message should appear
    await waitFor(() => {
      expect(screen.getByText("keyboard submit")).toBeInTheDocument();
    });
  });

  it("Shift+Enter does not submit", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(textarea, "line two");

    // Text should still be in the textarea, not submitted
    expect(textarea).toHaveValue("line one\nline two");
    // No message in the chat
    expect(screen.queryByText("line one")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error states during messaging
// ---------------------------------------------------------------------------
describe("Error states during messaging", () => {
  async function submit(text: string) {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });
    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, text);
    await user.click(
      textarea.closest("form")!.querySelector('button[type="submit"]')!,
    );
    return user;
  }

  // Send-path errors render inside the assistant bubble instead of the banner —
  // showing both would duplicate the same text. The full-screen blocker is also
  // off-limits for runtime failures (reserved for startup health probe).
  it("network failure on conversation create renders in the assistant bubble", async () => {
    mockFetch({ conversations: { ok: false } });
    await submit("Will fail");

    await waitFor(() => {
      expect(screen.getByText(/can't reach the server/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Connection Error")).not.toBeInTheDocument();
  });

  it("403 on message send renders the authorization message in the bubble", async () => {
    mockFetch({ messages: { ok: false, status: 403 } });
    await submit("Will fail on send");

    await waitFor(() => {
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("503 on message send renders the unavailable message in the bubble", async () => {
    mockFetch({ messages: { ok: false, status: 503 } });
    await submit("Will fail on send");

    await waitFor(() => {
      expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("500 on message send renders the generic server-error message in the bubble", async () => {
    mockFetch({ messages: { ok: false, status: 500 } });
    await submit("Will fail on send");

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SSE reconnect with backoff
// ---------------------------------------------------------------------------
describe("SSE reconnect", () => {
  it("on stream error, shows the reconnecting indicator and opens a new stream after backoff", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { es } = await renderAndSendMessage("Hi");
      const original = es;

      act(() => {
        es.simulateError();
      });

      // Indicator appears immediately
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/reconnecting/i);
      });

      // Advance past the first backoff window (250ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      // A fresh EventSource should have been created
      expect(MockEventSource.latest).not.toBe(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the reconnecting indicator when the new stream opens", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { es } = await renderAndSendMessage("Hi");
      act(() => {
        es.simulateError();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const fresh = MockEventSource.latest!;
      expect(fresh).not.toBe(es);

      act(() => {
        fresh.simulateOpen();
      });

      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("after exhausting retries, surfaces the failure in the assistant bubble", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderAndSendMessage("Hi");
      // 6 errors: 5 retries then give-up. Each retry needs its own
      // simulateError on the *new* MockEventSource.
      for (let i = 0; i < 6; i++) {
        const current = MockEventSource.latest!;
        act(() => {
          current.simulateError();
        });
        // Drain the backoff window (5s cap covers every step)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6000);
        });
      }

      await waitFor(() => {
        expect(screen.getByText(/lost connection to the server/i)).toBeInTheDocument();
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Banner — used for errors with no conversation turn to attach to
// ---------------------------------------------------------------------------
describe("Error banner", () => {
  it("500 on /api/agent/config shows the inline banner", async () => {
    mockFetch({ configError: 500 });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    });
  });

  it("banner can be dismissed", async () => {
    const user = userEvent.setup();
    mockFetch({ configError: 500 });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Theme localStorage persistence
// ---------------------------------------------------------------------------
describe("Theme localStorage persistence", () => {
  it("toggling theme writes to localStorage", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Playground")).toBeInTheDocument();
    });

    const toggle = screen.getByTitle(/Switch to dark mode|Switch to light mode/);
    await user.click(toggle);

    expect(localStorage.getItem("theme")).toBe("dark");

    await user.click(toggle);

    expect(localStorage.getItem("theme")).toBe("light");
  });
});
