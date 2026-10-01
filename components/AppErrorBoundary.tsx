import React from 'react';

export default class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[app:render]', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6">
        <div role="alert" className="max-w-md rounded-3xl bg-white p-6 text-center shadow-lg">
          <h1 className="text-xl font-bold">Не удалось открыть приложение</h1>
          <p className="mt-3 text-sm text-slate-600">
            Сохранённые данные остались на устройстве. Перезагрузите страницу и попробуйте снова.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white"
          >
            Перезагрузить
          </button>
        </div>
      </main>
    );
  }
}
