import { loadEnv, type Plugin, type ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";

type CoreMessage = { role: "user" | "assistant" | "system"; content: string };

type SSEEvent = { event: string; data: Record<string, unknown> };

type Conversation = {
  messages: CoreMessage[];
  emitter: EventEmitter;
};

const conversations = new Map<string, Conversation>();

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

export function devAgentPlugin(): Plugin {
  return {
    name: "dev-agent",
    configureServer(server: ViteDevServer) {
      const env = loadEnv("development", server.config.root, "");

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

              try {
                const apiKey = env.OPENAI_API_KEY;
                if (!apiKey) {
                  send("error", { message: "OPENAI_API_KEY is not set." });
                  return;
                }

                const { streamText } = await import("ai");
                const { createOpenAI } = await import("@ai-sdk/openai");
                const openai = createOpenAI({ apiKey });

                // In dev mode, we simulate STT by telling the model it received audio
                convo.messages.push({
                  role: "user",
                  content: "[The user sent a voice message. Respond naturally as if you understood them. Since this is a dev mock, acknowledge that you received audio input and respond helpfully.]",
                });

                let hadError = false;
                const result = streamText({
                  model: openai("gpt-4o"),
                  messages: convo.messages,
                  onError: ({ error }) => {
                    hadError = true;
                    const message = error instanceof Error ? error.message : String(error);
                    send("error", { message });
                  },
                });

                let fullResponse = "";
                for await (const chunk of result.textStream) {
                  fullResponse += chunk;
                  send("chunk", { content: chunk, chunk_type: "delta" });
                }

                if (!hadError) {
                  convo.messages.push({ role: "assistant", content: fullResponse });
                  send("finish", {});
                }
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

        try {
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
              const apiKey = env.OPENAI_API_KEY;
              if (!apiKey) {
                emit("error", {
                  type: "error",
                  message:
                    "OPENAI_API_KEY is not set. Create a .env file in packages/astro-playground with your key.",
                });
                return;
              }

              const { streamText, tool } = await import("ai");
              const { createOpenAI } = await import("@ai-sdk/openai");
              const { z } = await import("zod");
              const openai = createOpenAI({ apiKey });

              let hadError = false;

              const result = streamText({
                model: openai("gpt-4o"),
                messages: convo.messages,
                tools: {
                  randomNumber: tool({
                    description:
                      "Generates a random number between min and max (inclusive).",
                    parameters: z.object({
                      min: z.number().describe("Minimum value"),
                      max: z.number().describe("Maximum value"),
                    }),
                    execute: async ({ min, max }) => {
                      return {
                        value:
                          Math.floor(Math.random() * (max - min + 1)) + min,
                      };
                    },
                  }),
                },
                maxSteps: 5,
                onChunk: ({ chunk }) => {
                  if (chunk.type === "tool-call") {
                    emit("step-start", {
                      type: "step-start",
                      step_id: chunk.toolCallId,
                      name: chunk.toolName,
                    });
                  } else if (chunk.type === "tool-result") {
                    emit("step-end", {
                      type: "step-end",
                      step_id: chunk.toolCallId,
                    });
                  }
                },
                onError: ({ error }) => {
                  hadError = true;
                  const message =
                    error instanceof Error ? error.message : String(error);
                  emit("error", { type: "error", message });
                },
              });

              let fullResponse = "";
              for await (const chunk of result.textStream) {
                fullResponse += chunk;
                emit("chunk", {
                  type: "chunk",
                  content: chunk,
                  chunk_type: "delta",
                });
              }

              if (!hadError) {
                convo.messages.push({
                  role: "assistant",
                  content: fullResponse,
                });
                emit("finish", { type: "finish" });
              }
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
