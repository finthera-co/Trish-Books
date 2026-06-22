import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * App-wide render guard. Without this, a single component throwing during render
 * (e.g. a date helper hitting a null value) unmounts the entire React tree and
 * leaves a blank white screen with no clue. This catches the throw, keeps the
 * app shell alive, and surfaces the actual error + a recovery path.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for diagnosis (and any attached logging).
    console.error("Render error caught by ErrorBoundary:", error, info.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This page hit an unexpected error. The rest of the app is still working.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-muted/50 p-3 text-left text-[11px] text-muted-foreground">
            {error.message}
          </pre>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={this.handleReset}>Try again</Button>
            <Button onClick={() => { window.location.href = "/"; }}>Go home</Button>
          </div>
        </div>
      </div>
    );
  }
}
