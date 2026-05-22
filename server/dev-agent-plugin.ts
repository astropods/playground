import { type Plugin, type ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { faults, matchFault, type FaultRule } from "./faults";

type CoreMessage = { role: "user" | "assistant" | "system"; content: string };

type SSEEvent = { event: string; data: Record<string, unknown> };

type Conversation = {
  messages: CoreMessage[];
  emitter: EventEmitter;
};

const conversations = new Map<string, Conversation>();

type Emit = (event: string, data: Record<string, unknown>) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stream `text` to the client one chunk at a time. Chunk size is intentionally
// small so the UI smoothing has buffer to work with and word boundaries are
// visible mid-stream — both are part of what we're testing.
async function streamText(emit: Emit, text: string, chunkSize = 18, delayMs = 30) {
  for (let i = 0; i < text.length; i += chunkSize) {
    emit("chunk", {
      type: "chunk",
      content: text.slice(i, i + chunkSize),
      chunk_type: "delta",
    });
    await sleep(delayMs);
  }
}

// Stream `text` into the assistant's `reasoning` channel so the LiveReasoning
// indicator above the bubble lights up.
async function streamReasoning(emit: Emit, text: string, chunkSize = 12, delayMs = 25) {
  for (let i = 0; i < text.length; i += chunkSize) {
    emit("reasoning-delta", {
      type: "reasoning-delta",
      content: text.slice(i, i + chunkSize),
    });
    await sleep(delayMs);
  }
}

// Fire a tool call as a step-start / step-end pair, sleeping in between so
// the running shimmer state is observable. `id` is stable so the UI can match
// the pair; `name` becomes the label in the ToolStrip.
async function runTool(emit: Emit, name: string, durationMs = 800) {
  const id = `step-${Math.random().toString(36).slice(2, 10)}`;
  emit("step-start", { type: "step-start", step_id: id, name });
  await sleep(durationMs);
  emit("step-end", { type: "step-end", step_id: id });
}

// A markdown sample that exercises Streamdown's interesting paths: headings,
// inline emphasis, links, ordered/unordered lists, a fenced code block, and
// a table. Kept inline so the mock is self-contained.
const DEFAULT_MARKDOWN_REPLY = `Here's a quick rundown.

## What changed

- **Streaming** is now smoothed at the client; chunks are released word-by-word.
- *Tool calls* render inline, in the same place they ran.
- Scrolling sticks to the bottom only when you're already there — try scrolling up mid-stream.

### A small code sample

\`\`\`ts
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

### A few links

See the [Streamdown docs](https://streamdown.ai) for the rendering layer.

| Feature | Before | After |
| --- | --- | --- |
| Markdown | react-markdown | streamdown |
| Scroll | jacked | sticky |
| Tools | chip row | inline strip |

That's it — type \`help\` to see every scenario, or jump straight to \`markdown\`, \`tools\`, \`reason\`, \`long\`, or \`error\`.`;

// A maximalist markdown sample. Goes well past the default reply: nested
// lists, task lists, blockquotes, strikethrough, multiple code languages,
// inline code, a wider table, an image, a horizontal rule, footnotes, and
// (since Streamdown supports them) a KaTeX math block and a Mermaid diagram.
const MARKDOWN_SHOWCASE = `# Markdown showcase

A wide sample for stress-testing the renderer.

---

## Text styling

You can write **bold**, *italic*, ***bold-italic***, ~~strikethrough~~, \`inline code\`, and [external links](https://streamdown.ai). Subscript like H~2~O and superscript like E=mc^2^ aren't part of CommonMark — they should render as plain text.

> Blockquotes work, including across
> multiple lines, and can contain **formatting**
> and \`inline code\`.

## Lists

Unordered, nested:

- Top-level item one
  - Sub-item with \`code\`
  - Sub-item with a [link](https://example.com)
    - A third level
- Top-level item two

Ordered:

1. First
2. Second
   1. Nested first
   2. Nested second
3. Third

Task list:

- [x] Port the chat UI
- [x] Wire the dev mock
- [ ] Smoke-test in a real browser
- [ ] Ship it

## Code

A short shell snippet:

\`\`\`bash
bun run dev
curl -s http://localhost:5173/health | jq
\`\`\`

A longer TypeScript example with comments and types:

\`\`\`ts
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

async function fetchUser(id: string): Promise<Result<{ id: string; name: string }>> {
  try {
    const res = await fetch(\`/api/users/\${id}\`);
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    return { ok: true, value: await res.json() };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}
\`\`\`

A bit of Python for variety:

\`\`\`python
def fib(n: int) -> list[int]:
    """Return the first n Fibonacci numbers."""
    out = [0, 1]
    while len(out) < n:
        out.append(out[-1] + out[-2])
    return out[:n]

print(fib(10))
\`\`\`

## Tables

| Feature | Status | Notes |
| --- | :---: | --- |
| Streaming markdown | ✅ | via Streamdown |
| Inline tool calls | ✅ | ToolStrip with shimmer |
| Sticky scroll | ✅ | only sticks when at bottom |
| Voice input | ✅ | unchanged |
| Reasoning channel | ✅ | fades out on \`finish\` |
| Mermaid diagrams | 🧪 | requires Streamdown plugin |
| KaTeX math | 🧪 | requires Streamdown plugin |

## Math

Inline math: $E = mc^2$. Block math:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\, dx = \\sqrt{\\pi}
$$

## Diagram

\`\`\`mermaid
flowchart TD
  user([User])
  user --> input[Textarea]
  input --> chat[useChat hook]
  chat -->|POST /messages| api[(Server)]
  api -->|SSE stream| sse[setupEventSource]
  sse -->|chunk| smooth[RAF smoothing buffer]
  sse -->|step-start / step-end| tools[ToolStrip]
  sse -->|reasoning-delta| reason[LiveReasoning]
  smooth --> render[Streamdown]
  render --> bubble[Assistant bubble]
  tools --> bubble
  reason -.fades out.-> bubble
\`\`\`

## Inline assets

A tiny inline SVG via an image reference: ![dot](https://placehold.co/16x16/4f46e5/white.png)

---

That's the whole tour. If something renders oddly, it's probably worth a screenshot before reporting.`;

const LONG_REPLY = Array.from({ length: 20 }, (_, i) => {
  return `### Section ${i + 1}\n\nThis is paragraph ${i + 1} of a long mock response, designed to overflow the viewport so you can verify that auto-scroll only kicks in while you're parked at the bottom. Scroll up mid-stream — the scroll-to-bottom button should appear and the viewport should stay where you put it.`;
}).join("\n\n");

const HELP_REPLY = `Here are the scenarios the dev mock can play. Matching is **case-insensitive substring** — your message just has to contain the keyword.

| Keyword | What it does |
| --- | --- |
| \`help\` | This message |
| \`markdown\` | Maximalist showcase — nested lists, task lists, multiple code blocks, blockquote, wider table, math, mermaid |
| \`tool\` | Single tool call — simple ToolStrip summary |
| \`tools\` | Two tool calls between text parts — multi-tool dropdown, inline placement |
| \`reason\` | Streams \`reasoning-delta\` above the bubble, then fades out |
| \`long\` | 20-section response — scroll up mid-stream to test sticky scroll |
| \`error\` | Emits an \`error\` event — renders inside the bubble |
| (anything else) | Default markdown reply — headings, lists, code, table, link. Try \`hi\`. |

You can also inject HTTP faults from the browser console:

\`\`\`js
__faults.deny()        // 403 on next send
__faults.unavail()     // 503
__faults.crash()       // 500
__faults.authExpired() // 401
__faults.clear()       // reset
\`\`\`

No LLM is being called — this is a canned reply from the Vite dev plugin.`;

// Top-level scenario router. Looks at the user's most recent message and
// picks a path; falls back to the markdown reply.
async function streamScenario(emit: Emit, userInput: string): Promise<string> {
  const input = userInput.toLowerCase();

  if (input.includes("help")) {
    await streamText(emit, HELP_REPLY, 24, 12);
    emit("finish", { type: "finish" });
    return HELP_REPLY;
  }

  if (input.includes("error")) {
    emit("error", { type: "error", message: "Mock error: something exploded." });
    return "(mock error)";
  }

  if (input.includes("markdown")) {
    await streamText(emit, MARKDOWN_SHOWCASE, 28, 12);
    emit("finish", { type: "finish" });
    return MARKDOWN_SHOWCASE;
  }

  if (input.includes("long")) {
    await streamText(emit, LONG_REPLY, 24, 12);
    emit("finish", { type: "finish" });
    return LONG_REPLY;
  }

  if (input.includes("reason")) {
    await streamReasoning(
      emit,
      "Hmm, the user is asking me to think out loud. I'll work through this step by step before answering.",
    );
    await sleep(150);
    const reply = "Done thinking. Here's the answer — reasoning should have just faded out above this bubble.";
    await streamText(emit, reply);
    emit("finish", { type: "finish" });
    return reply;
  }

  if (input.includes("tools")) {
    // Pre-tool text, then a pair of tool calls, then a post-tool answer.
    // The ToolStrip should render between the two text bubbles.
    const opener = "Let me look that up for you.\n\n";
    await streamText(emit, opener);
    await runTool(emit, "search_web");
    await runTool(emit, "summarize_results");
    await sleep(120);
    const closer = "Here's what I found:\n\n- The first result was promising.\n- The second confirmed it.\n- The third disagreed but I'm ignoring it.";
    await streamText(emit, closer);
    emit("finish", { type: "finish" });
    return opener + closer;
  }

  if (input.includes("tool")) {
    // Single tool case so the strip shows the simple summary instead of the
    // multi-tool dropdown.
    await runTool(emit, "lookup_database", 1000);
    await sleep(120);
    const reply = "Looked it up. The database returned exactly what we expected.";
    await streamText(emit, reply);
    emit("finish", { type: "finish" });
    return reply;
  }

  await streamText(emit, DEFAULT_MARKDOWN_REPLY);
  emit("finish", { type: "finish" });
  return DEFAULT_MARKDOWN_REPLY;
}

// Backwards-compatible wrapper used by the SSE message handler and the audio
// path. Either pass plain text (legacy mode for the audio transcript) or run
// the scenario router based on the message content.
async function streamDummyReply(emit: Emit, userInput: string): Promise<string> {
  return streamScenario(emit, userInput);
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function extractConversationId(
  url: string,
  prefix: string,
  suffix: string
): string | null {
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  if (suffix && slashIdx === -1) return null;
  const id = suffix ? rest.slice(0, slashIdx) : rest;
  if (suffix && !rest.slice(slashIdx).startsWith(suffix)) return null;
  return id || null;
}

// Injected into the playground page so faults can be triggered from the
// browser console: `__faults.deny()`, `__faults.unavail()`, etc. Kept in
// sync with the admin endpoints above. Dev-only because the plugin sets
// `apply: 'serve'`.
const FAULT_HELPER_SCRIPT = `
  window.__faults = {
    add: (rule) => fetch('/__dev/faults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    }).then((r) => r.json()),
    clear: () => fetch('/__dev/faults', { method: 'DELETE' }).then((r) => r.json()),
    list: () => fetch('/__dev/faults').then((r) => r.json()),
    deny:    (target = 'messages', count = 1) => window.__faults.add({ path: '/api/conversations/*/' + target, method: 'POST', status: 403, count }),
    unavail: (target = 'messages', count = 1) => window.__faults.add({ path: '/api/conversations/*/' + target, method: 'POST', status: 503, count }),
    crash:   (target = 'messages', count = 1) => window.__faults.add({ path: '/api/conversations/*/' + target, method: 'POST', status: 500, count }),
    authExpired: (target = 'messages', count = 1) => window.__faults.add({ path: '/api/conversations/*/' + target, method: 'POST', status: 401, count }),
  };
  console.info('[dev] fault injection ready — see window.__faults');
`;

export function devAgentPlugin(): Plugin {
  return {
    name: "dev-agent",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [{ tag: "script", injectTo: "head", children: FAULT_HELPER_SCRIPT }];
      },
    },
    configureServer(server: ViteDevServer) {
      // WebSocket server for audio streaming
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = req.url ?? "";
        const audioId = extractConversationId(url, "/api/conversations/", "/audio");
        if (!audioId) return; // let Vite handle HMR upgrades

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, audioId);
        });
      });

      wss.on("connection", async (ws: WebSocket, _req: IncomingMessage, conversationId: string) => {
        const convo = conversations.get(conversationId);
        if (!convo) {
          ws.send(JSON.stringify({ type: "error", message: "Conversation not found" }));
          ws.close();
          return;
        }

        let audioReceived = false;

        ws.on("message", async (data: Buffer | string, isBinary: boolean) => {
          if (isBinary || Buffer.isBuffer(data)) {
            // Binary frame = audio chunk, just accumulate
            audioReceived = true;
            return;
          }

          // Text frame = JSON control message
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "audio.config") {
              // Config received, ready for audio
              return;
            }
            if (msg.type === "audio.end") {
              // Audio segment complete — generate response
              if (!audioReceived) return;

              const send = (event: string, payload: Record<string, unknown>) =>
                ws.send(JSON.stringify({ type: event, ...payload }));

              const transcript = "[voice message]";
              convo.messages.push({ role: "user", content: transcript });
              try {
                const reply = await streamDummyReply(send, transcript);
                convo.messages.push({ role: "assistant", content: reply });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Stream failed";
                send("error", { message });
              }

              audioReceived = false;
            }
          } catch {
            // ignore invalid JSON
          }
        });
      });

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        const method = req.method ?? "GET";
        const pathOnly = url.split("?")[0];

        try {
          // Fault-injection admin endpoints.
          if (pathOnly === "/__dev/faults") {
            if (method === "GET") return json(res, 200, faults);
            if (method === "POST") {
              const body = (await parseBody(req)) as Partial<FaultRule>;
              if (typeof body.path !== "string" || typeof body.status !== "number") {
                return json(res, 400, { error: "path (string) and status (number) required" });
              }
              const rule: FaultRule = {
                path: body.path,
                method: typeof body.method === "string" ? body.method : undefined,
                status: body.status,
                body: body.body,
                count: typeof body.count === "number" ? body.count : 1,
              };
              faults.push(rule);
              return json(res, 200, rule);
            }
            if (method === "DELETE") {
              faults.length = 0;
              return json(res, 200, { ok: true });
            }
          }

          // Apply matching fault before any real handler runs.
          const fault = matchFault(pathOnly, method);
          if (fault) {
            return json(res, fault.status, fault.body ?? { error: `injected fault (${fault.status})` });
          }

          // GET /health
          if (url === "/health" && method === "GET") {
            return json(res, 200, { status: "ok" });
          }

          // GET /api/agent/config
          if (url === "/api/agent/config" && method === "GET") {
            return json(res, 200, {
              systemPrompt: "You are a helpful assistant.",
              tools: [
                {
                  name: "randomNumber",
                  title: "Random Number",
                  description:
                    "Generates a random number between a minimum and maximum value.",
                  type: "other",
                },
              ],
            });
          }

          // POST /api/conversations
          if (url === "/api/conversations" && method === "POST") {
            const id = crypto.randomUUID();
            conversations.set(id, {
              messages: [],
              emitter: new EventEmitter(),
            });
            return json(res, 200, { conversation_id: id });
          }

          // GET /api/conversations/:id/stream — SSE subscriber
          const streamId = extractConversationId(
            url,
            "/api/conversations/",
            "/stream"
          );
          if (streamId && method === "GET") {
            const convo = conversations.get(streamId);
            if (!convo)
              return json(res, 404, { error: "Conversation not found" });

            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });

            const write = ({ event, data }: SSEEvent) => {
              res.write(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              );
            };

            write({ event: "connected", data: { type: "connected" } });

            convo.emitter.on("sse", write);
            req.on("close", () => convo.emitter.off("sse", write));
            return;
          }

          // POST /api/conversations/:id/messages — emits SSE events
          const msgId = extractConversationId(
            url,
            "/api/conversations/",
            "/messages"
          );
          if (msgId && method === "POST") {
            const convo = conversations.get(msgId);
            if (!convo)
              return json(res, 404, { error: "Conversation not found" });

            const body = await parseBody(req);
            const content = body.content as string;
            const files = Array.isArray(body.files)
              ? (body.files as Array<{
                  name?: string;
                  type?: string;
                  data?: string;
                  isBase64Encoded?: boolean;
                }>)
              : [];

            // Prepend an attachment ack to the prompt so the canned scenarios
            // visibly react to the file the user attached.
            const attachmentSummary = files.length
              ? `Received ${files.length} attachment${files.length > 1 ? "s" : ""}: ` +
                files
                  .map(
                    (f) =>
                      `**${f.name ?? "unnamed"}** (${f.type || "application/octet-stream"}, ${
                        f.isBase64Encoded ? "base64" : "text"
                      }, ${typeof f.data === "string" ? f.data.length : 0} chars).`,
                  )
                  .join(" ") +
                "\n\n"
              : "";

            convo.messages.push({ role: "user", content });
            json(res, 200, { ok: true });

            // The client opens its EventSource in parallel with this POST, so
            // the GET /stream subscriber may not have attached by the time we
            // start emitting. Wait briefly so the first chunk isn't lost —
            // this matters most for instant-emit scenarios (e.g. the `error`
            // path that fires a single event with no delays). Production
            // backends don't have this race since they hold the POST open
            // until the stream finishes.
            for (let i = 0; i < 100 && convo.emitter.listenerCount("sse") === 0; i++) {
              await new Promise((r) => setTimeout(r, 10));
            }

            const emit = (event: string, data: Record<string, unknown>) =>
              convo.emitter.emit("sse", { event, data });

            try {
              if (attachmentSummary) {
                await streamText(emit, attachmentSummary, 24, 12);
              }
              const reply = await streamDummyReply(emit, content);
              convo.messages.push({
                role: "assistant",
                content: attachmentSummary + reply,
              });
            } catch (err: unknown) {
              const message =
                err instanceof Error ? err.message : "Stream failed";
              emit("error", { type: "error", message });
            }
            return;
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Internal server error";
          json(res, 500, { error: message });
          return;
        }

        next();
      });
    },
  };
}
