import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { logger } from '../logging';

type SupplierSlidesErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class SupplierSlidesErrorBoundary extends React.Component<React.PropsWithChildren, SupplierSlidesErrorBoundaryState> {
  state: SupplierSlidesErrorBoundaryState = { hasError: false, message: '' };

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
        </div>
      );
    }

    return this.props.children;
  }
}
