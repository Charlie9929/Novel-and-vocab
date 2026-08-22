import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The reader failed to render.", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-shell centered-shell app-error" role="alert">
        <div className="brand-mark">读</div>
        <h1>页面加载失败</h1>
        <p>请刷新一次页面；如果仍然失败，可以先清除本站缓存后重新打开。</p>
        <button className="primary-button" type="button" onClick={this.handleReload}>
          重新加载
        </button>
      </main>
    );
  }
}
