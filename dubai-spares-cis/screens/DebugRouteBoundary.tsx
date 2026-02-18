import React from 'react';
import { LOCAL_ONLY } from '../localMode';
import { logger } from '../logging';

type DebugRouteBoundaryState = {
  hasError: boolean;
  message: string;
};

const buildMinimalDiagnostics = (message: string) => JSON.stringify({
  appVersion: (import.meta as any).env?.VITE_APP_VERSION || 'dev',
  localOnly: LOCAL_ONLY,
  route: '#/debug',
  lastError: message,
  userAgent: navigator.userAgent,
  capturedAt: new Date().toISOString()
}, null, 2);

export class DebugRouteBoundary extends React.Component<React.PropsWithChildren, DebugRouteBoundaryState> {
  state: DebugRouteBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): DebugRouteBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    void logger.error('ui:error-boundary', 'route_render_failed', {
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
      componentStack: info.componentStack
    });
  }

  private onCopy = async () => {
    const payload = buildMinimalDiagnostics(this.state.message || 'Unknown debug screen error');
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // no-op fallback UI should remain stable
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 pb-24 space-y-3">
          <h1 className="text-lg font-black">Debug unavailable</h1>
          <p className="text-xs text-rose-700">Debug screen failed to render. The rest of the app is still safe to use.</p>
          <p className="text-xs text-gray-600 break-words">Last error: {this.state.message || 'unknown'}</p>
          <button className="rounded-lg bg-slate-900 text-white px-3 py-2 text-xs font-black" type="button" onClick={() => void this.onCopy()}>
            Copy minimal diagnostics
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
