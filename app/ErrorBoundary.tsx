import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

// Root error boundary. Catches uncaught render exceptions that bypass the
// app's per-fetch try/catch — e.g. malformed data in a list render, a
// dependency throwing during initial render, an undefined access in a
// computed value. The reload button is the recovery affordance; without
// this the user sees a blank screen.

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logs to the dev console in development and to the surrounding
    // logging stack in production (browser collects unhandled errors).
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8 bg-background">
        <div className="w-20 h-20 rounded-2xl bg-destructive flex items-center justify-center mb-6 shadow-lg shadow-destructive/20">
          <AlertCircle className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">
          Something went wrong
        </h2>
        <p className="text-muted-foreground max-w-md mb-6">
          The playground hit an unexpected error and can't continue. Reload to
          start a fresh session.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
        >
          Reload
        </button>
      </div>
    );
  }
}
