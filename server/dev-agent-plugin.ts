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

// Dummy reply generator. The dev plugin doesn't call any LLM — it streams a
// canned response so the playground works out of the box without an API key
// and gives predictable input for UI work. `emit` follows the same
// `(event, data)` shape used by both the SSE and audio paths so this helper
// is reusable across both.
async function streamDummyReply(
  emit: (event: string, data: Record<string, unknown>) => void,
  userInput: string,
): Promise<string> {
  const snippet = userInput.slice(0, 80).replace(/\s+/g, " ").trim();
  const reply = `(dev mock) You said: "${snippet}". This is a canned reply from the dev plugin — no LLM is being called. Wire a real backend for live answers.`;
  const CHUNK_SIZE = 18;
  for (let i = 0; i < reply.length; i += CHUNK_SIZE) {
    emit("chunk", {
      type: "chunk",
      content: reply.slice(i, i + CHUNK_SIZE),
      chunk_type: "delta",
    });
    await new Promise((r) => setTimeout(r, 30));
  }
  emit("finish", { type: "finish" });
  return reply;
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

            convo.messages.push({ role: "user", content });
            json(res, 200, { ok: true });

            const emit = (event: string, data: Record<string, unknown>) =>
              convo.emitter.emit("sse", { event, data });

            try {
              const reply = await streamDummyReply(emit, content);
              convo.messages.push({ role: "assistant", content: reply });
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
