import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown, Loader2, Mic, Square, Brain } from "lucide-react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { createMathPlugin } from "@streamdown/math";
// KaTeX ships the CSS for math glyphs / fonts separately — @streamdown/math
// only wires up the parser. Importing here so the math plugin actually
// typesets in the browser instead of showing raw symbols.
import "katex/dist/katex.min.css";
import { mermaid } from "@streamdown/mermaid";
import { Tooltip, TooltipTrigger, TooltipContent } from "../Tooltip";
import type { Message, ToolCallPart } from "../hooks/useChat";
import { ToolStrip } from "./ToolStrip";
import {
  AttachButton,
  AttachmentChip,
  AttachmentPill,
  FileAttachModal,
  type FileAttachment,
} from "./FileAttachment";
import playgroundIllustration from "../playground-empty-state.svg";
import playgroundIllustrationDark from "../playground-empty-state-dark.svg";

// Math + diagram support are opt-in plugins. We allow single-dollar inline
// math (`$E = mc^2$`) since that's what most agents emit; the default would
// require `$$...$$` for everything. Mermaid uses the pre-configured plugin —
// no need to override its config.
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });
const streamdownPlugins = { math: mathPlugin, mermaid };

// Hide the fullscreen control on mermaid + table panels: it didn't behave
// reliably in our embed context, and dropping it also normalises the
// remaining icon order to [download, copy] across both code blocks and
// mermaid blocks (streamdown ships them in that order natively).
const streamdownControls = {
  mermaid: { fullscreen: false },
  table: { fullscreen: false },
} as const;

const MAX_MESSAGE_LENGTH = 4000;

// Reasoning that fades out once the agent stops thinking. Kept here (rather
// than rendered as a part) because it's an out-of-band signal from the agent.
function LiveReasoning({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (!isStreaming && reasoning) {
      setIsFadingOut(true);
      const t = setTimeout(() => setIsVisible(false), 500);
      return () => clearTimeout(t);
    }
  }, [isStreaming, reasoning]);

  if (!reasoning || !isVisible) return null;

  return (
    <div
      className={`mb-3 flex items-start gap-2 transition-opacity duration-500 ${
        isFadingOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <Brain className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0 animate-pulse" />
      <p className="text-xs text-muted-foreground italic leading-relaxed">
        {reasoning}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-muted-foreground rounded-sm ml-1 animate-pulse opacity-50" />
        )}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-flex gap-1 items-center">
      <span
        className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
        style={{ animationDelay: "200ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
        style={{ animationDelay: "400ms" }}
      />
    </span>
  );
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="mb-6">
        <img src={playgroundIllustration} alt="" className="h-16 dark:hidden" />
        <img src={playgroundIllustrationDark} alt="" className="hidden h-16 dark:block" />
      </div>
      <h2 className="text-2xl font-semibold text-foreground mb-2">Agent Playground</h2>
      <p className="text-muted-foreground max-w-md">
        Test and interact with your AI agent. Send a message below to start a conversation.
      </p>
    </div>
  );
}

function AssistantMessage({
  message,
  isLast,
  isStreaming,
}: {
  message: Message;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const isMessageStreaming = isStreaming && isLast;
  const hasParts = message.parts.length > 0;

  // No parts yet but we know more is coming — show a spinner bubble so the
  // user sees something happening immediately after submit.
  if (!hasParts && isMessageStreaming) {
    return (
      <div className="flex flex-col items-start gap-2">
        {message.reasoning && (
          <LiveReasoning reasoning={message.reasoning} isStreaming={true} />
        )}
        <div className="rounded-2xl px-4 py-3 bg-white dark:bg-slate-900">
          <Spinner />
        </div>
      </div>
    );
  }

  // Group consecutive tool-call parts so each cluster renders as a single
  // ToolStrip in place, between the text parts that surround it.
  const toolGroups: { startIndex: number; tools: ToolCallPart[] }[] = [];
  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i];
    if (part.type === "tool-call") {
      const prev = toolGroups[toolGroups.length - 1];
      if (prev && prev.startIndex + prev.tools.length === i) {
        prev.tools.push(part);
      } else {
        toolGroups.push({ startIndex: i, tools: [part] });
      }
    }
  }
  const toolGroupAt = new Map(toolGroups.map((g) => [g.startIndex, g]));

  // Find the last text part index to know which one is actively streaming.
  let lastTextIndex = -1;
  for (let i = message.parts.length - 1; i >= 0; i--) {
    if (message.parts[i].type === "text") {
      lastTextIndex = i;
      break;
    }
  }

  const formattedTs = formatTimestamp(message.timestamp);
  const showTimestamp = !message.isStreaming && hasParts && formattedTs;

  return (
    <div className="flex flex-col items-start gap-2 max-w-[85%]">
      {message.reasoning && (
        <LiveReasoning
          reasoning={message.reasoning}
          isStreaming={message.isStreaming ?? false}
        />
      )}
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          const text = part.content.trim();
          if (!text) return null;
          const isLastText = i === lastTextIndex;
          const isPartAnimating = isMessageStreaming && isLastText;
          return (
            <div
              key={`text-${i}`}
              className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-white dark:bg-slate-900 text-foreground markdown-content"
            >
              <Streamdown
                animated={{ animation: "fadeIn", duration: 150, easing: "ease", sep: "word" }}
                isAnimating={isPartAnimating}
                parseIncompleteMarkdown={isPartAnimating}
                plugins={streamdownPlugins}
                controls={streamdownControls}
              >
                {text}
              </Streamdown>
            </div>
          );
        }
        const group = toolGroupAt.get(i);
        if (group) {
          return (
            <div key={`tools-${i}`} className="my-1">
              <ToolStrip tools={group.tools} />
            </div>
          );
        }
        return null;
      })}
      {showTimestamp && (
        <span className="text-xs text-muted-foreground">{formattedTs}</span>
      )}
    </div>
  );
}

function UserMessage({ message }: { message: Message }) {
  const isAudioPlaceholder =
    message.inputModality === "audio" &&
    (message.content === "[Listening...]" || message.content === "[Voice message]");
  const formattedTs = formatTimestamp(message.timestamp);
  const hasFiles = !!message.files?.length;
  const hasContent = message.content.length > 0;

  return (
    <div className="flex flex-col items-end max-w-[85%] ml-auto">
      <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-slate-200 dark:bg-slate-800 text-foreground whitespace-pre-wrap space-y-2">
        {hasFiles && (
          <div className="flex flex-col items-stretch gap-1.5">
            {message.files!.map((f, i) => (
              <AttachmentChip key={i} attachment={f} />
            ))}
          </div>
        )}
        {isAudioPlaceholder ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mic className="w-4 h-4" />
            <span>
              {message.content === "[Listening...]" ? "Listening..." : "Voice message"}
            </span>
          </div>
        ) : message.inputModality === "audio" ? (
          <div className="flex items-start gap-2">
            <Mic className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <span>{message.content}</span>
          </div>
        ) : hasContent ? (
          message.content
        ) : null}
      </div>
      {formattedTs && (
        <span className="mt-1 text-xs text-muted-foreground">{formattedTs}</span>
      )}
    </div>
  );
}

export type ThreadProps = {
  messages: Message[];
  isStreaming: boolean;
  onSend: (text: string, files?: FileAttachment[]) => void;
  // Audio controls — optional so the Thread is usable without voice.
  audio?: {
    isListening: boolean;
    isRecording: boolean;
    recordingDuration: number;
    voiceMode: "single" | "continuous";
    toggleListening: () => void;
    toggleVoiceMode: () => void;
  };
};

export function Thread({ messages, isStreaming, onSend, audio }: ThreadProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // isSticky tracks whether the auto-scroll loop should keep snapping to the
  // bottom. It flips OFF only on real user gestures (wheel / touch / key),
  // never on programmatic scrolls — otherwise the scroll event from our own
  // scrollIntoView races with the next chunk's content growth and we'd lose
  // stickiness mid-stream.
  const isStickyRef = useRef(true);
  // Set while the user is actively scrolling so the scroll handler knows
  // a position change is intentional rather than a side-effect of our own
  // scrollIntoView. Cleared on a short delay after the last gesture.
  const userScrollingRef = useRef(false);
  const userScrollingTimeoutRef = useRef<number | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const hasMessages = messages.length > 0;
  const isListening = audio?.isListening ?? false;
  const isRecording = audio?.isRecording ?? false;

  // Focus on mount and after the listening/recording UI collapses back to
  // a textarea.
  useEffect(() => {
    if (!isListening && !isRecording) {
      textareaRef.current?.focus();
    }
  }, [isListening, isRecording]);

  // Wire user-gesture + scroll listeners on the scroll container. The
  // gesture listeners mark a 200ms window during which scroll events are
  // attributed to the user; outside that window scroll events are assumed
  // to come from our own scrollIntoView and don't update stickiness.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const markUserScrolling = () => {
      userScrollingRef.current = true;
      if (userScrollingTimeoutRef.current !== null) {
        window.clearTimeout(userScrollingTimeoutRef.current);
      }
      userScrollingTimeoutRef.current = window.setTimeout(() => {
        userScrollingRef.current = false;
      }, 200);
    };

    const onScroll = () => {
      if (!userScrollingRef.current) return; // programmatic — leave isSticky alone
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      isStickyRef.current = atBottom;
      setShowScrollButton(!atBottom);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", markUserScrolling, { passive: true });
    container.addEventListener("touchstart", markUserScrolling, { passive: true });
    container.addEventListener("touchmove", markUserScrolling, { passive: true });
    container.addEventListener("keydown", markUserScrolling);

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", markUserScrolling);
      container.removeEventListener("touchstart", markUserScrolling);
      container.removeEventListener("touchmove", markUserScrolling);
      container.removeEventListener("keydown", markUserScrolling);
      if (userScrollingTimeoutRef.current !== null) {
        window.clearTimeout(userScrollingTimeoutRef.current);
      }
    };
  }, []);

  // Auto-scroll on new content while sticky. Instant scroll (not smooth)
  // to avoid race conditions with rapid streaming updates.
  useEffect(() => {
    if (isStickyRef.current) {
      bottomRef.current?.scrollIntoView();
    }
  }, [messages]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isStreaming) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    setInput("");
    const files = attachments.length > 0 ? attachments : undefined;
    setAttachments([]);
    isStickyRef.current = true;
    setShowScrollButton(false);
    onSend(text, files);
  };

  // Auto-grow the textarea up to a reasonable cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "72px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-6 py-6 bg-slate-100 dark:bg-slate-950 relative"
      >
        <div
          className={`max-w-3xl mx-auto ${
            messages.length === 0 ? "h-full flex flex-col" : "space-y-6"
          }`}
        >
          {!hasMessages ? (
            <EmptyState />
          ) : (
            <>
              {messages.map((message, i) => {
                const isLast = i === messages.length - 1;
                return message.role === "user" ? (
                  <UserMessage key={message.id} message={message} />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isLast={isLast}
                    isStreaming={isStreaming}
                  />
                );
              })}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {showScrollButton && hasMessages && (
          <button
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              isStickyRef.current = true;
              setShowScrollButton(false);
            }}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors shadow-md"
            aria-label="Scroll to latest"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-border bg-background">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div
            className={`relative flex flex-col gap-1 p-2 bg-muted rounded-[20px] border transition-colors ${
              isRecording
                ? "border-red-500"
                : isListening
                  ? "border-amber-500"
                  : "border-border focus-within:border-primary"
            }`}
          >
            {isListening || isRecording ? (
              <div className="flex items-center justify-center gap-3 px-3 py-2 min-h-[72px]">
                {isRecording ? (
                  <>
                    <span className="recording-pulse w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm text-foreground">
                      Speaking
                      {audio && audio.recordingDuration > 0
                        ? ` — ${Math.floor(audio.recordingDuration / 60)}:${(audio.recordingDuration % 60).toString().padStart(2, "0")}`
                        : "..."}
                    </span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-amber-500 animate-pulse" />
                    <span className="text-sm text-muted-foreground">
                      Listening for speech...
                    </span>
                  </>
                )}
              </div>
            ) : (
              <>
                {attachments.length > 0 && (
                  <div className="px-1 pt-1 flex flex-col gap-1.5">
                    {attachments.map((a, i) => (
                      <AttachmentPill
                        key={`${a.name}-${i}`}
                        attachment={a}
                        onRemove={() =>
                          setAttachments((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Send a message..."
                  rows={1}
                  maxLength={MAX_MESSAGE_LENGTH}
                  className="w-full bg-transparent px-3 py-2 text-foreground placeholder:text-muted-foreground resize-none outline-none text-sm min-h-[72px] max-h-[200px]"
                  style={{ height: "72px" }}
                />
              </>
            )}
            <div className="flex items-center justify-end gap-2">
              {!(isListening || isRecording) && (
                <AttachButton
                  onClick={() => setAttachOpen(true)}
                  disabled={isStreaming}
                />
              )}
              {audio && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={audio.toggleListening}
                    disabled={!isListening && !isRecording && isStreaming}
                    className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                      isRecording
                        ? "bg-red-500 hover:bg-red-600 text-white"
                        : isListening
                          ? "bg-amber-500 hover:bg-amber-600 text-white"
                          : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    }`}
                    title={
                      isRecording
                        ? "Speech detected — click to stop"
                        : isListening
                          ? "Listening — click to stop"
                          : "Start voice input"
                    }
                  >
                    {isRecording ? (
                      <Square className="w-4 h-4" />
                    ) : (
                      <Mic className={`w-4 h-4 ${isListening ? "animate-pulse" : ""}`} />
                    )}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={audio.toggleVoiceMode}
                        className={`absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full border text-[9px] font-medium flex items-center justify-center transition-colors ${
                          audio.voiceMode === "continuous"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-muted-foreground border-border hover:border-primary"
                        }`}
                      >
                        {audio.voiceMode === "continuous" ? "∞" : "1×"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {audio.voiceMode === "continuous"
                        ? "Stays listening between turns"
                        : "Records once, then stops"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              {!(isListening || isRecording) && (
                <button
                  type="submit"
                  disabled={(!input.trim() && attachments.length === 0) || isStreaming}
                  className="shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 transition-all duration-200"
                >
                  {isStreaming ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-3">
            {isRecording ? (
              <>
                <span className="recording-pulse inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />
                Speaking
                {audio && audio.recordingDuration > 0
                  ? ` — ${Math.floor(audio.recordingDuration / 60)}:${(audio.recordingDuration % 60).toString().padStart(2, "0")}`
                  : "..."}
              </>
            ) : isListening ? (
              `Listening for speech${audio?.voiceMode === "continuous" ? " (continuous)" : ""}...`
            ) : (
              "Press Enter to send, Shift+Enter for new line"
            )}
          </p>
        </form>
      </div>

      <FileAttachModal
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttach={(added) => setAttachments((prev) => [...prev, ...added])}
      />
    </>
  );
}
