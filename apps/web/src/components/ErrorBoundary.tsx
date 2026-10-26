import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/** Last line of defence: shows a friendly recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tally crashed", error, info.componentStack);
  }

  private reset = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("calc."))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage blocked */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1 className="crash__title">Something went wrong</h1>
        <p>Tally hit a problem it couldn't recover from. Resetting clears the history saved on this device.</p>
        <div className="crash__actions">
          <button type="button" className="crash__btn" onClick={() => window.location.reload()}>
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
