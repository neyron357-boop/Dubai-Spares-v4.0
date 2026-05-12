import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const DEBUG_INDEX_STORAGE_KEY = 'debug-index-visible-v1';

const DebugIndexContext = createContext<{ enabled: boolean; toggle: () => void }>({ enabled: true, toggle: () => undefined });

const SCREEN_PREFIXES: Array<{ test: (pathname: string) => boolean; prefix: string }> = [
  { test: (p) => p.startsWith('/orders'), prefix: '2' },
  { test: (p) => p.startsWith('/order/'), prefix: '3' },
  { test: (p) => p.startsWith('/new') || p.startsWith('/request') || p.startsWith('/order-form') || p.startsWith('/public-order-form'), prefix: '4' },
  { test: (p) => p.startsWith('/settings'), prefix: '5' },
  { test: (p) => p.startsWith('/database') || p.startsWith('/variants') || p.startsWith('/vendor'), prefix: '6' },
  { test: (p) => p.startsWith('/notifications'), prefix: '7' }
];

const resolvePrefix = (pathname: string) => SCREEN_PREFIXES.find((entry) => entry.test(pathname))?.prefix || '9';

const NUMBERABLE_SELECTOR = [
  'main', 'form', 'section', 'article', 'nav', 'header', 'footer', 'aside',
  'button', 'a[href]', 'input', 'textarea', 'select', '[role="button"]', '[role="region"]',
  'div', 'ul', 'ol', 'li', 'label', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'img'
].join(',');

const useAutoDebugIndexing = (enabled: boolean) => {
  useEffect(() => {
    document.body.classList.toggle('debug-index-enabled', enabled);

    if (!enabled) {
      return () => {
        document.body.classList.remove('debug-index-enabled');
      };
    }

    const applyIndexes = () => {
      const pathname = window.location.hash.replace(/^#/, '') || '/';
      const prefix = resolvePrefix(pathname);
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(NUMBERABLE_SELECTOR));

      let number = 1;
      nodes.forEach((node) => {
        if (!node.offsetParent && node !== document.body) return;
        node.dataset.debugId = `${prefix}.${String(number).padStart(4, '0')}`;
        number += 1;
      });
    };

    applyIndexes();
    const observer = new MutationObserver(() => applyIndexes());
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener('hashchange', applyIndexes);

    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', applyIndexes);
      document.body.classList.remove('debug-index-enabled');
    };
  }, [enabled]);
};

export const DebugIndexProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const saved = window.localStorage.getItem(DEBUG_INDEX_STORAGE_KEY);
    return saved === null ? true : saved === '1';
  });

  useAutoDebugIndexing(enabled);

  useEffect(() => {
    window.localStorage.setItem(DEBUG_INDEX_STORAGE_KEY, enabled ? '1' : '0');
  }, [enabled]);

  const value = useMemo(() => ({ enabled, toggle: () => setEnabled((prev) => !prev) }), [enabled]);

  return (
    <DebugIndexContext.Provider value={value}>
      <style>{`
        body.debug-index-enabled [data-debug-id] { position: relative; }
        body.debug-index-enabled [data-debug-id]::after {
          content: attr(data-debug-id);
          position: absolute;
          right: 2px;
          top: 2px;
          font-size: 8px;
          line-height: 1;
          background: rgba(107,114,128,0.25);
          color: #4b5563;
          border-radius: 3px;
          padding: 1px 2px;
          pointer-events: none;
          z-index: 200;
        }
      `}</style>
      {children}
    </DebugIndexContext.Provider>
  );
};

export const useDebugIndex = () => useContext(DebugIndexContext);

export const DebugIndex: React.FC<{ indexId: string; className?: string; children: React.ReactNode }> = ({ indexId, className = '', children }) => (
  <div className={`relative ${className}`.trim()} data-debug-id={indexId}>
    {children}
  </div>
);
