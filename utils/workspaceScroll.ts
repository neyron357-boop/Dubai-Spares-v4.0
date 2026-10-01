export function getWorkspaceScrollTop() {
  const main = document.querySelector('main');
  return window.scrollY || (main instanceof HTMLElement ? main.scrollTop : 0);
}
export function restoreWorkspaceScrollTop(top: number) {
  if (!Number.isFinite(top) || top < 0) return;
  window.scrollTo({ top, behavior: 'instant' });
  const main = document.querySelector('main');
  if (main instanceof HTMLElement) main.scrollTop = top;
}
