import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Without this, an uncaught render error (e.g. a live API returning a shape
// the frontend didn't expect - see api.ts's normalizeActiveMessage) unmounts
// the ENTIRE React root, leaving a blank page with no way to tell what broke
// or navigate elsewhere. This catches it at the route level so the nav shell
// stays usable and the error is visible instead of silent.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="role-denied">
          <h1>Something went wrong on this page</h1>
          <p>{this.state.error.message}</p>
          <button className="btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
