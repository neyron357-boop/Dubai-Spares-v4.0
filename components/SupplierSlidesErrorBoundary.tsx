import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { logger } from '../logging';

type SupplierSlidesErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class SupplierSlidesErrorBoundary extends React.Component<React.PropsWithChildren, SupplierSlidesErrorBoundaryState> {
  state: SupplierSlidesErrorBoundaryState = { hasError: false, message: '' };

  private readonly handleReload = () => {
    this.setState({ hasError: false, message: '' });
  };

  private readonly copyDebugInfo = async () => {
    const payload = JSON.stringify({
      component: 'SupplierSlides',
      route: '#/vendor',
      message: this.state.message || 'unknown',
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator === 'undefined' ? 'n/a' : navigator.userAgent,
    });

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      }
    } catch {
      // no-op
    }

    void logger.warn('ui:error-boundary', 'supplier_slides_debug_payload', { payload });
  };

  static getDerivedStateFromError(error: unknown): SupplierSlidesErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    void logger.error('ui:error-boundary', 'supplier_slides_render_failed', {
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
      componentStack: info.componentStack,
      route: '#/vendor'
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 z-50 bg-[#0B1220] text-white flex flex-col items-center justify-center p-6 text-center gap-3">
          <div className="h-12 w-12 rounded-full bg-rose-500/20 grid place-items-center text-rose-300">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-lg font-black">Supplier Slides временно недоступен</h1>
          <p className="text-sm text-white/70">Произошла ошибка в слайдах. Экран не будет пустым — попробуйте вернуться назад и открыть карточку снова.</p>
          <p className="text-xs text-white/50 break-words">Ошибка: {this.state.message || 'unknown'}</p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={this.handleReload} className="rounded-xl border border-emerald-400/60 px-3 py-2 text-xs font-bold text-emerald-200">
              Reload slide
            </button>
            <button type="button" onClick={() => void this.copyDebugInfo()} className="rounded-xl border border-slate-500 px-3 py-2 text-xs font-bold text-white/80">
              Copy debug
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
