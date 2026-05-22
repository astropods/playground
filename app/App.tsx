import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Wrench,
  AlertCircle,
  MessageSquare,
  Settings2,
  FileText,
  Sun,
  Moon,
} from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  useReactFlow,
  Position,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import astroLogo from "./astro-logo.svg";
import astroLogoDark from "./astro-logo-dark.svg";
import { useAudio } from "./hooks/useAudio";
import { useChat } from "./hooks/useChat";
import { useSkills } from "./hooks/useSkills";
import { TooltipProvider } from "./Tooltip";
import { Thread } from "./components/Thread";
import {
  request,
  userMessageForError,
} from "./api/client";

// Runtime config from window.__ENV__ (injected by nginx) or Vite env or default
declare global {
  interface Window {
    __ENV__?: {
      API_URL?: string;
    };
  }
}

// Use relative URLs by default (works with nginx proxy), allow override via env
const API_URL = window.__ENV__?.API_URL ?? import.meta.env.VITE_API_URL ?? "";

type ToolConfig = {
  name: string;
  title: string;
  description: string;
  type: "graph" | "other";
  graph?: {
    nodes: { id: string; name: string; type: string }[];
    edges: { id: string; source: string; target: string }[];
  };
};

type AgentConfig = {
  systemPrompt: string;
  tools: ToolConfig[];
};

type ViewMode = "chat" | "config";

function ViewToggle({
  viewMode,
  onToggle,
}: {
  viewMode: ViewMode;
  onToggle: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex items-center bg-muted rounded-md p-1 border border-border">
      <button
        onClick={() => onToggle("chat")}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm font-medium transition-all duration-200 ${
          viewMode === "chat"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <MessageSquare className="w-4 h-4" />
        Chat
      </button>
      <button
        onClick={() => onToggle("config")}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm font-medium transition-all duration-200 ${
          viewMode === "config"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Settings2 className="w-4 h-4" />
        Config
      </button>
    </div>
  );
}

function ThemeToggle() {
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains("dark"));

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center justify-center w-9 h-9 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

function GraphNode({ data }: NodeProps) {
  const isStartOrEnd = data.isStart || data.isEnd;
  const targetPositionMap: Record<string, Position> = {
    left: Position.Left,
    top: Position.Top,
    right: Position.Right,
    bottom: Position.Bottom,
  };
  const sourcePositionMap: Record<string, Position> = {
    left: Position.Left,
    top: Position.Top,
    right: Position.Right,
    bottom: Position.Bottom,
  };
  const targetPosition = targetPositionMap[data.targetPosition as string] || Position.Left;
  const sourcePosition = sourcePositionMap[data.sourcePosition as string] || Position.Right;

  return (
    <div
      className={`text-xs text-center min-w-[120px] rounded-lg border px-4 py-2 ${
        isStartOrEnd
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card text-card-foreground border-border"
      }`}
    >
      <Handle type="target" position={targetPosition} />
      {typeof data.label === "string" ? data.label : JSON.stringify(data.label)}
      <Handle type="source" position={sourcePosition} />
    </div>
  );
}

const nodeTypes = { graphNode: GraphNode };
const NODE_WIDTH = 172;
const NODE_HEIGHT = 36;

function getLayoutedElements(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: "TB" | "LR" = "LR",
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  dagre.layout(dagreGraph);
  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        targetPosition: isHorizontal ? "left" : "top",
        sourcePosition: isHorizontal ? "right" : "bottom",
      },
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });
  return { nodes: newNodes, edges };
}

function ToolGraphFlowInner({ tool }: { tool: ToolConfig }) {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(() => {
    if (!tool.graph) return { nodes: [], edges: [] };
    const nodesWithOutgoing = new Set(tool.graph.edges.map((e) => e.source));
    const terminalNodeIds = tool.graph.nodes
      .filter((node) => !nodesWithOutgoing.has(node.id))
      .map((node) => node.id);
    const flowNodes: FlowNode[] = tool.graph.nodes.map((node) => ({
      id: node.id,
      type: "graphNode",
      position: { x: 0, y: 0 },
      data: { label: node.name, isStart: node.type === "start" },
    }));
    const endNodeId = "__end__";
    flowNodes.push({
      id: endNodeId,
      type: "graphNode",
      position: { x: 0, y: 0 },
      data: { label: "End", isEnd: true },
    });
    const flowEdges: FlowEdge[] = tool.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: true,
    }));
    terminalNodeIds.forEach((nodeId, index) => {
      flowEdges.push({
        id: `__end_edge_${index}`,
        source: nodeId,
        target: endNodeId,
        animated: true,
      });
    });
    return getLayoutedElements(flowNodes, flowEdges, "LR");
  }, [tool.graph]);

  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.3, duration: 200 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [nodes, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={true}
      zoomOnScroll={true}
      zoomOnPinch={true}
      zoomOnDoubleClick={false}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--muted-foreground)" gap={16} size={1} />
    </ReactFlow>
  );
}

function ToolGraphView({ tool }: { tool: ToolConfig }) {
  if (!tool.graph) return null;
  const nodeCount = tool.graph.nodes.length;
  const height = Math.max(200, Math.min(400, nodeCount * 30));
  return (
    <div
      className="w-full bg-background rounded-lg border border-border mt-3"
      style={{ height: `${height}px` }}
    >
      <ReactFlowProvider>
        <ToolGraphFlowInner tool={tool} />
      </ReactFlowProvider>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolConfig }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasGraph = tool.type === "graph" && tool.graph;
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => hasGraph && setIsExpanded(!isExpanded)}
        className={`w-full flex items-start gap-3 p-3 text-left ${
          hasGraph ? "cursor-pointer hover:bg-muted" : "cursor-default"
        } transition-colors`}
        disabled={!hasGraph}
      >
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Wrench className="w-4 h-4 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground">{tool.title}</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {tool.description || "No description"}
          </p>
        </div>
        {hasGraph && (
          <div className="shrink-0 text-muted-foreground">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        )}
      </button>
      {isExpanded && hasGraph && (
        <div className="px-3 pb-3">
          <ToolGraphView tool={tool} />
        </div>
      )}
    </div>
  );
}

function AgentConfigView({
  config,
  isLoading,
}: {
  config: AgentConfig | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No configuration available
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-muted border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-card border-b border-border">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">System Prompt</h3>
          </div>
          <div className="p-4">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {config.systemPrompt || "No system prompt configured"}
            </p>
          </div>
        </div>
        <div className="bg-muted border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-card border-b border-border">
            <Wrench className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Available Tools</h3>
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-mono">
              {config.tools.length} tool{config.tools.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="p-4">
            {config.tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tools configured</p>
            ) : (
              <div className="space-y-3">
                {config.tools.map((tool, index) => (
                  <ToolCard key={index} tool={tool} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="shrink-0 px-6 py-2 border-b border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3"
    >
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span className="text-sm flex-1">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-xs px-2 py-1 rounded hover:bg-destructive/20 transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}

function ConnectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="w-20 h-20 rounded-2xl bg-destructive flex items-center justify-center mb-6 shadow-lg shadow-destructive/20">
        <AlertCircle className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-foreground mb-2">Connection Error</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        Unable to connect to the messaging service. Make sure astro-messaging is running with the
        web adapter enabled.
      </p>
      <code className="px-4 py-2 bg-muted border border-border rounded-lg text-sm font-mono text-foreground/80 mb-6">
        WEB_ENABLED=true astro-messaging
      </code>
      <button
        onClick={onRetry}
        className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
      >
        Retry Connection
      </button>
    </div>
  );
}

export default function App() {
  // startupFailed: true only when the initial /health probe fails on mount.
  // Renders the full-screen ConnectionError block. Other runtime errors go to
  // the inline banner instead so the app stays usable.
  const [startupFailed, setStartupFailed] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  const {
    messages,
    setMessages,
    isStreaming,
    setIsStreaming,
    streamReconnecting,
    conversationId,
    setConversationId,
    sendText,
    sendSkill,
    createConversation,
    setupEventSource,
    registerPendingUserMsgIdGetter,
    generateId,
  } = useChat({ apiUrl: API_URL, onError: setErrorBanner });

  // Health check. On the startup probe a failure renders the full-screen
  // ConnectionError; subsequent manual retries clear startupFailed on success.
  const checkConnection = useCallback(async () => {
    try {
      await request(`${API_URL}/health`);
      setStartupFailed(false);
      return true;
    } catch {
      setStartupFailed(true);
      return false;
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Fetch agent config for the Config tab. Missing config is normal (404),
  // surface other failures to the banner so users know the tab is empty
  // because of a real error rather than missing data.
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const cfg = await request<AgentConfig>(`${API_URL}/api/agent/config`, {
          nullOn404: true,
        });
        if (cfg) setAgentConfig(cfg);
      } catch (err) {
        setErrorBanner(userMessageForError(err));
      } finally {
        setIsLoadingConfig(false);
      }
    };
    fetchConfig();
  }, []);

  const { skills } = useSkills(API_URL);

  const audio = useAudio({
    conversationId,
    setConversationId,
    createConversation,
    setupEventSource,
    setMessages,
    setIsLoading: setIsStreaming,
    isLoading: isStreaming,
    generateId,
    apiUrl: API_URL,
    onError: setErrorBanner,
  });

  // The transcript SSE event needs to know which user-message bubble to
  // rewrite — register the audio hook's getter once, and the chat hook will
  // call it at event time.
  useEffect(() => {
    registerPendingUserMsgIdGetter(audio.getPendingUserMsgId);
    return () => registerPendingUserMsgIdGetter(null);
  }, [audio.getPendingUserMsgId, registerPendingUserMsgIdGetter]);

  if (startupFailed) {
    return (
      <div className="h-full flex flex-col bg-background">
        <ConnectionError onRetry={checkConnection} />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <header className="shrink-0 px-6 py-4 border-b border-border bg-background relative z-10">
          <div className="max-w-3xl mx-auto grid grid-cols-3 items-center">
            <div className="flex items-center gap-3">
              <img src={astroLogo} alt="Astro" className="h-5 dark:hidden" />
              <img src={astroLogoDark} alt="Astro" className="hidden h-5 dark:block" />
            </div>
            <div className="flex items-center justify-center">
              <ViewToggle viewMode={viewMode} onToggle={setViewMode} />
            </div>
            <div className="flex items-center justify-end">
              <ThemeToggle />
            </div>
          </div>
        </header>

        {errorBanner && (
          <ErrorBanner message={errorBanner} onDismiss={() => setErrorBanner(null)} />
        )}

        {streamReconnecting && (
          <div
            role="status"
            aria-live="polite"
            className="shrink-0 px-6 py-2 border-b border-border bg-muted text-muted-foreground flex items-center gap-2 text-sm"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Reconnecting to the stream…</span>
          </div>
        )}

        {viewMode === "config" ? (
          <AgentConfigView config={agentConfig} isLoading={isLoadingConfig} />
        ) : (
          <Thread
            messages={messages}
            isStreaming={isStreaming}
            onSend={(text) => {
              setErrorBanner(null);
              sendText(text);
            }}
            skills={skills}
            onInvokeSkill={(name, args) => {
              setErrorBanner(null);
              sendSkill(name, args);
            }}
            audio={{
              isListening: audio.isListening,
              isRecording: audio.isRecording,
              recordingDuration: audio.recordingDuration,
              voiceMode: audio.voiceMode,
              toggleListening: audio.toggleListening,
              toggleVoiceMode: audio.toggleVoiceMode,
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
