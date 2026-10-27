import { Component, createRef, type ErrorInfo, type ReactNode } from "react";
import { clearAppStorage } from "../lib/storage";

interface State {
  failed: boolean;
  /** Bumped on retry so the app subtree remounts from scratch. */
  attempt: number;
}

/** Last line of defence: shows a friendly recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, attempt: 0 };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tally crashed", error, info.componentStack);
  }

  componentDidUpdate(_: unknown, prev: State) {
    // Move focus to the message so keyboard and screen reader users land on it.
    if (this.state.failed && !prev.failed) this.heading.current?.focus();
  }

  componentDidMount() {
    if (this.state.failed) this.heading.current?.focus();
  }

  private retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));

  private reset = () => {
    clearAppStorage();
    this.retry();
  };

  render() {
    if (!this.state.failed) return <ErrorBoundaryKey key={this.state.attempt}>{this.props.children}</ErrorBoundaryKey>;
    return (
      <main className="crash" role="alert">
        <h1 className="crash__title" ref={this.heading} tabIndex={-1}>
          Something went wrong
        </h1>
        <p>Tally hit a problem it couldn't recover from. Resetting clears the history saved on this device.</p>
        <div className="crash__actions">
          <button type="button" className="crash__btn" onClick={this.retry}>
            Try again
          </button>
          <button type="button" className="crash__btn crash__btn--primary" onClick={this.reset}>
            Reset and reload
          </button>
        </div>
      </main>
    );
  }
}

function ErrorBoundaryKey({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
