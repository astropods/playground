import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ToolCallPart } from "../hooks/useChat";

// Format a snake_case or camelCase tool name into a friendlier label. The
// playground is agent-agnostic, so we don't keep a hardcoded mapping — we just
// titlecase the tool name and pair it with a verb that makes sense for both
// the running and completed states.
function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function getToolLabel(toolName: string): { action: string; past: string } {
  const human = humanize(toolName);
  return { action: `Running ${human}`, past: `Used ${human}` };
}

function getToolSummary(tools: ToolCallPart[]): string {
  const pastLabels = [...new Set(tools.map((t) => getToolLabel(t.toolName).past))];
  if (pastLabels.length <= 2) return pastLabels.join(" & ");
  return `${pastLabels.slice(0, -1).join(", ")} & ${pastLabels[pastLabels.length - 1]}`;
}

// ShimmerText paints a moving gradient over the text fill while the tool is
// still running. The text is still in the DOM, just visually shimmering.
function ShimmerText({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block"
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--muted-foreground) 0%, var(--muted-foreground) 40%, var(--foreground) 50%, var(--muted-foreground) 60%, var(--muted-foreground) 100%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: "shimmer 1.5s ease-in-out infinite",
      }}
    >
      {children}
    </span>
  );
}

export function ToolStrip({ tools }: { tools: ToolCallPart[] }) {
  const [expanded, setExpanded] = useState(false);
  const [displayedTool, setDisplayedTool] = useState<ToolCallPart | null>(null);
  const [animating, setAnimating] = useState<"enter" | "exit" | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const pendingRef = useRef<ToolCallPart | null>(null);

  const allDone = tools.length > 0 && tools.every((t) => t.done);
  const activeTool = !allDone ? [...tools].reverse().find((t) => !t.done) ?? null : null;

  // Rotate the actively-streaming tool with enter/exit animations between
  // each one so the strip feels alive as the agent decides what to run next.
  useEffect(() => {
    if (allDone) return;
    if (activeTool === displayedTool) return;
    if (activeTool && !displayedTool) {
      setDisplayedTool(activeTool);
      setAnimating("enter");
      const t = setTimeout(() => setAnimating(null), 200);
      return () => clearTimeout(t);
    }
    if (activeTool && displayedTool) {
      pendingRef.current = activeTool;
      setAnimating("exit");
      const t = setTimeout(() => {
        setDisplayedTool(pendingRef.current);
        pendingRef.current = null;
        setAnimating("enter");
        setTimeout(() => setAnimating(null), 200);
      }, 150);
      return () => clearTimeout(t);
    }
  }, [activeTool?.toolCallId, allDone]);

  // When the last tool finishes, exit the streaming tool then reveal the
  // summary. Skip the exit hop if there's nothing currently shown.
  useEffect(() => {
    if (!allDone || showSummary) return;
    if (displayedTool) {
      setAnimating("exit");
      const t = setTimeout(() => {
        setShowSummary(true);
        setAnimating("enter");
        setTimeout(() => setAnimating(null), 200);
      }, 150);
      return () => clearTimeout(t);
    }
    setShowSummary(true);
  }, [allDone]);

  if (tools.length === 0) return null;

  // All done — show the summary, with a dropdown if there are multiple tools.
  if (allDone && showSummary) {
    const summaryAnimClass = animating === "enter" ? "animate-[tool-enter_0.2s_ease-out]" : "";
    if (tools.length === 1) {
      const { past } = getToolLabel(tools[0].toolName);
      return (
        <div className="text-xs text-muted-foreground italic overflow-hidden">
          <div className={summaryAnimClass}>
            <span className="sr-only">{tools[0].toolName}</span>
            {past}
          </div>
        </div>
      );
    }
    return (
      <div className="text-xs text-muted-foreground italic">
        <div className={summaryAnimClass}>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          >
            <span>{getToolSummary(tools)}</span>
            <ChevronDown
              className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        {/* Hidden tool names so screen readers (and tests) can locate them
            even when the summary is collapsed. */}
        <span className="sr-only">{tools.map((t) => t.toolName).join(", ")}</span>
        {expanded && (
          <div className="mt-1 flex flex-col gap-0.5 pl-2 border-l border-border">
            {tools.map((t) => (
              <span key={t.toolCallId}>{getToolLabel(t.toolName).past}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Streaming — show the rotating active tool.
  if (!displayedTool) return null;
  const { action } = getToolLabel(displayedTool.toolName);
  const animClass =
    animating === "enter"
      ? "animate-[tool-enter_0.2s_ease-out]"
      : animating === "exit"
        ? "animate-[tool-exit_0.15s_ease-in_forwards]"
        : "";

  return (
    <div className="text-xs italic overflow-hidden">
      <div className={animClass} key={displayedTool.toolCallId}>
        <ShimmerText>
          {/* keep the raw tool name in the DOM as well so tests / a11y can find it */}
          <span className="sr-only">{displayedTool.toolName}</span>
          {action}
        </ShimmerText>
      </div>
    </div>
  );
}
