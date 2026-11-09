import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Otaku Time crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-ink px-6 text-paper">
        <div className="w-full max-w-md text-center">
          <p className="mono-label mb-2 text-accent">App error</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Something went wrong
          </h1>
          <p className="mt-3 text-[1rem] leading-relaxed text-paper-dim">
            Try reloading the page. Your saved watchlist may still be available in this browser.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="tap-target mx-auto mt-7 flex items-center gap-2.5 rounded-full bg-accent px-7 py-3.5 text-[1rem] font-semibold text-ink transition-transform active:scale-95"
          >
            <RefreshCw size={18} strokeWidth={2.2} />
            Reload
          </button>
        </div>
      </div>
    );
  }
}
