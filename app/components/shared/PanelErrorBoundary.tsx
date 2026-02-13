import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const msg = error.message;
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk")
  );
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[PanelErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={32} className="text-amber-500" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {this.props.fallbackLabel ?? "Something went wrong in this panel."}
          </p>
          <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
            {chunkError
              ? "A newer version is available. Please reload the page."
              : this.state.error?.message}
          </p>
          {chunkError ? (
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
            >
              Reload page
            </button>
          ) : (
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
            >
              Try again
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
