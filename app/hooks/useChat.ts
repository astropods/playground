import { useCallback, useEffect, useRef, useState } from "react";
import {
  request,
  userMessageForError,
  AuthRequiredError,
  ForbiddenError,
} from "../api/client";

export type TextPart = { type: "text"; content: string };

export type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  done: boolean;
  output?: unknown;
};

export type MessagePart = TextPart | ToolCallPart;

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: MessagePart[];
  reasoning?: string;
  isStreaming?: boolean;
  inputModality?: "text" | "audio";
  timestamp: number;
};

// Smoothing factor: each frame, advance this fraction of the remaining buffer.
// 0.06 at 60fps means ~96% caught up in ~50 frames (~830ms). Creates a smooth
// ease-out: fast when buffer is large, slow when small.
const SMOOTH_FACTOR = 0.06;
// Minimum chars to keep in the buffer before we stop advancing. Prevents
// catching up fully and pausing between chunks. Released to 0 when the stream
// signals it's done (the `finish` SSE event), so the tail flushes cleanly.
const MIN_BUFFER_HOLD = 4;

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// nextWordBoundary walks past the next whitespace run starting at `from`, so we
// only ever reveal whole words. Returns text.length once we're past the end.
function nextWordBoundary(text: string, from: number): number {
  let i = Math.ceil(from);
  if (i >= text.length) return text.length;
  while (i < text.length && text[i] !== " " && text[i] !== "\n") i++;
  while (i < text.length && (text[i] === " " || text[i] === "\n")) i++;
  return i;
}

type UseChatOptions = {
  apiUrl: string;
  onError?: (message: string) => void;
};

export function useChat({ apiUrl, onError }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamReconnecting, setStreamReconnecting] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(
    new URLSearchParams(window.location.search).get("conversation"),
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  // The audio path needs to tell us which user message bubble to rewrite when
  // a transcript SSE event arrives. We hold a getter (not a value) so we read
  // the latest id at the moment the event fires, not at register time.
  const pendingUserMsgIdGetterRef = useRef<(() => string | null) | null>(null);

  // Smoothing state per active assistant message. Reset on every new turn.
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeTextRef = useRef(""); // full text target as received from server
  const smoothPosRef = useRef(0); // fractional position (lerps toward target.length)
  const displayedLenRef = useRef(0); // word-snapped position actually shown
  const streamDoneRef = useRef(false);
  const rafRef = useRef<number>(0);

  // Flush the smoothed window into the active assistant message's trailing
  // text part. If the trailing part is a tool-call (or parts is empty), push
  // a fresh text part — otherwise we'd overwrite text that was already
  // committed before the tool call ran.
  const flushDisplayed = useCallback(() => {
    const id = activeAssistantIdRef.current;
    if (!id) return;
    const text = activeTextRef.current.slice(0, displayedLenRef.current);
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== id) return msg;
        const parts = [...msg.parts];
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          parts[parts.length - 1] = { type: "text", content: text };
        } else {
          parts.push({ type: "text", content: text });
        }
        // Concatenated text for legacy consumers (history POST, audio).
        const content = parts
          .filter((p): p is TextPart => p.type === "text")
          .map((p) => p.content)
          .join("\n\n");
        return { ...msg, parts, content };
      }),
    );
  }, []);

  // The smoothing loop. Single RAF tick for the lifetime of the hook.
  useEffect(() => {
    function tick() {
      if (activeAssistantIdRef.current) {
        const targetLen = activeTextRef.current.length;
        const currentPos = smoothPosRef.current;
        const remaining = targetLen - currentPos;
        const hold = streamDoneRef.current ? 0 : MIN_BUFFER_HOLD;

        if (remaining > hold) {
          const advance = remaining * SMOOTH_FACTOR;
          const newPos = currentPos + Math.max(advance, 0.5);
          smoothPosRef.current = Math.min(newPos, targetLen);

          const snapped = nextWordBoundary(activeTextRef.current, smoothPosRef.current);
          if (snapped !== displayedLenRef.current) {
            displayedLenRef.current = Math.min(snapped, targetLen);
            flushDisplayed();
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [flushDisplayed]);

  // Reset smoothing state for a new assistant turn.
  const beginActiveText = useCallback((assistantId: string) => {
    activeAssistantIdRef.current = assistantId;
    activeTextRef.current = "";
    smoothPosRef.current = 0;
    displayedLenRef.current = 0;
    streamDoneRef.current = false;
  }, []);

  // Append a text-delta into the smoothing target buffer. The RAF tick is the
  // sole writer to displayedLen / state — we just grow the target here.
  const appendTextDelta = useCallback((delta: string) => {
    if (!activeAssistantIdRef.current) return;
    activeTextRef.current += delta;
  }, []);

  // Commit any in-progress text part before something else (a tool call) goes
  // into the parts array. After this, a fresh text part can start.
  const commitActiveText = useCallback(() => {
    if (!activeAssistantIdRef.current || !activeTextRef.current) return;
    // Snap displayed to the full target before committing.
    displayedLenRef.current = activeTextRef.current.length;
    smoothPosRef.current = activeTextRef.current.length;
    flushDisplayed();
    activeTextRef.current = "";
    smoothPosRef.current = 0;
    displayedLenRef.current = 0;
  }, [flushDisplayed]);

  const addToolCallPart = useCallback(
    (assistantId: string, toolCallId: string, toolName: string, args?: Record<string, unknown>) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                parts: [
                  ...msg.parts,
                  {
                    type: "tool-call" as const,
                    toolCallId,
                    toolName,
                    args: args ?? {},
                    done: false,
                  },
                ],
              }
            : msg,
        ),
      );
    },
    [],
  );

  const markToolCallDone = useCallback(
    (assistantId: string, toolCallId: string, output?: unknown) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                parts: msg.parts.map((p) =>
                  p.type === "tool-call" && p.toolCallId === toolCallId
                    ? { ...p, done: true, output }
                    : p,
                ),
              }
            : msg,
        ),
      );
    },
    [],
  );

  const appendReasoning = useCallback((assistantId: string, content: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId ? { ...msg, reasoning: (msg.reasoning || "") + content } : msg,
      ),
    );
  }, []);

  const finalizeAssistant = useCallback((assistantId: string, opts?: { errorText?: string }) => {
    // Release the smoothing tail.
    streamDoneRef.current = true;
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg;
        if (opts?.errorText) {
          return {
            ...msg,
            parts: [{ type: "text" as const, content: opts.errorText }],
            content: opts.errorText,
            isStreaming: false,
          };
        }
        return { ...msg, isStreaming: false };
      }),
    );
    setIsStreaming(false);
  }, []);

  const createConversation = useCallback(async (): Promise<string> => {
    const data = await request<{ conversation_id: string }>(`${apiUrl}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!data) throw new Error("conversation create returned empty body");
    return data.conversation_id;
  }, [apiUrl]);

  // SSE setup with reconnect/backoff. Closes the prior stream on every call.
  const setupEventSource = useCallback((convId: string, assistantMessageId: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setStreamReconnecting(false);

    const MAX_ATTEMPTS = 5;
    const BASE_DELAY_MS = 250;
    const MAX_DELAY_MS = 5000;
    let attempt = 0;

    beginActiveText(assistantMessageId);

    const handleEvent = (event: MessageEvent) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (data.type) {
        case "chunk":
          appendTextDelta(data.content || "");
          break;

        case "step-start":
          // A tool call interrupts text — commit anything in flight first so
          // the tool strip renders inline at the right point in the parts list.
          commitActiveText();
          addToolCallPart(
            assistantMessageId,
            data.step_id,
            data.name,
            (data.args as Record<string, unknown>) ?? undefined,
          );
          break;

        case "step-end":
          markToolCallDone(assistantMessageId, data.step_id, data.output);
          break;

        case "reasoning-delta":
          appendReasoning(assistantMessageId, data.content || "");
          break;

        case "finish":
          finalizeAssistant(assistantMessageId);
          break;

        case "error":
          finalizeAssistant(assistantMessageId, {
            errorText: `Error: ${data.message || "Unknown error"}`,
          });
          break;

        case "transcript": {
          const userMsgId = data.message_id || pendingUserMsgIdGetterRef.current?.();
          if (userMsgId) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === userMsgId
                  ? {
                      ...msg,
                      content: data.text,
                      parts: [{ type: "text", content: data.text }],
                    }
                  : msg,
              ),
            );
          }
          break;
        }
      }
    };

    const giveUp = () => {
      setStreamReconnecting(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: msg.content || "Lost connection to the server. Please try again.",
                parts: msg.parts.length
                  ? msg.parts
                  : [
                      {
                        type: "text" as const,
                        content: "Lost connection to the server. Please try again.",
                      },
                    ],
                isStreaming: false,
              }
            : msg,
        ),
      );
      setIsStreaming(false);
    };

    const open = () => {
      const es = new EventSource(`${apiUrl}/api/conversations/${convId}/stream`);
      eventSourceRef.current = es;

      es.onopen = () => {
        // A successful (re)open resets the backoff so future hiccups within
        // this same stream get their full attempts.
        attempt = 0;
        setStreamReconnecting(false);
      };

      es.addEventListener("chunk", handleEvent);
      es.addEventListener("step-start", handleEvent);
      es.addEventListener("step-end", handleEvent);
      es.addEventListener("reasoning-delta", handleEvent);
      es.addEventListener("finish", handleEvent);
      es.addEventListener("error", handleEvent);
      es.addEventListener("connected", handleEvent);
      es.addEventListener("transcript", handleEvent);
      es.onmessage = handleEvent;

      es.onerror = () => {
        // Close the broken stream — the browser's auto-retry would otherwise
        // keep flapping in the background with no UI feedback.
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;

        if (attempt >= MAX_ATTEMPTS) {
          giveUp();
          return;
        }
        const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
        attempt++;
        setStreamReconnecting(true);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          open();
        }, delay);
      };
    };

    open();
  }, [
    apiUrl,
    appendTextDelta,
    appendReasoning,
    addToolCallPart,
    markToolCallDone,
    finalizeAssistant,
    beginActiveText,
    commitActiveText,
  ]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, []);

  // Load existing conversation history when a conversation id is pre-set
  // (e.g. an OAuth redirect). Optionally re-send the last user message so the
  // agent continues from where the redirect interrupted.
  useEffect(() => {
    if (!conversationId) return;
    const params = new URLSearchParams(window.location.search);
    const replayLast = params.get("replay_last") === "true";

    const loadHistory = async () => {
      try {
        const data = await request<{ messages: any[] }>(
          `${apiUrl}/api/conversations/${conversationId}/history`,
          { nullOn404: true },
        );
        if (!data) return;
        const loaded: Message[] = (data.messages ?? [])
          .filter(
            (m: any) =>
              m.content?.trim() && m.content !== "__auth_complete__" && m.message_id,
          )
          .map((m: any) => {
            const content = m.content as string;
            return {
              id: m.message_id,
              role: m.user?.id === "agent" ? ("assistant" as const) : ("user" as const),
              content,
              parts: [{ type: "text" as const, content }],
              timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
            };
          });
        if (loaded.length > 0) setMessages(loaded);

        if (replayLast) {
          const lastUserMsg = [...loaded].reverse().find((m) => m.role === "user");
          if (lastUserMsg) {
            const assistantMessageId = generateId();
            setMessages((prev) => [
              ...prev,
              {
                id: assistantMessageId,
                role: "assistant",
                content: "",
                parts: [],
                isStreaming: true,
                timestamp: Date.now(),
              },
            ]);
            setIsStreaming(true);
            setupEventSource(conversationId, assistantMessageId);
            await request(`${apiUrl}/api/conversations/${conversationId}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: lastUserMsg.content }),
            });
          }
        }
      } catch (err) {
        if (err instanceof AuthRequiredError || err instanceof ForbiddenError) {
          onError?.(userMessageForError(err));
        }
      }
    };
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Public: send a text message. Creates the conversation if needed.
  const sendText = useCallback(
    async (content: string) => {
      if (isStreaming) return;
      const now = Date.now();
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content,
        parts: [{ type: "text", content }],
        timestamp: now,
      };
      const assistantMessageId = generateId();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        parts: [],
        isStreaming: true,
        timestamp: now,
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      try {
        let convId = conversationId;
        if (!convId) {
          convId = await createConversation();
          setConversationId(convId);
        }
        setupEventSource(convId, assistantMessageId);
        await request(`${apiUrl}/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
      } catch (error) {
        // Send-path errors render inside the assistant bubble that's already on
        // screen — a banner would duplicate the same text two ways.
        const userMsg = userMessageForError(error);
        finalizeAssistant(assistantMessageId, { errorText: userMsg });
      }
    },
    [apiUrl, conversationId, createConversation, finalizeAssistant, isStreaming, setupEventSource],
  );

  const registerPendingUserMsgIdGetter = useCallback(
    (fn: (() => string | null) | null) => {
      pendingUserMsgIdGetterRef.current = fn;
    },
    [],
  );

  return {
    messages,
    setMessages,
    isStreaming,
    setIsStreaming,
    streamReconnecting,
    conversationId,
    setConversationId,
    sendText,
    createConversation,
    setupEventSource,
    registerPendingUserMsgIdGetter,
    generateId,
  };
}
