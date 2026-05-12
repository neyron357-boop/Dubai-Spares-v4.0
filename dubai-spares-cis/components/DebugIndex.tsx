import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const DEBUG_INDEX_STORAGE_KEY = 'debug-index-visible-v1';

const DebugIndexContext = createContext<{ enabled: boolean; toggle: () => void }>({ enabled: false, toggle: () => undefined });

export const DebugIndexProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState<boolean>(() => window.localStorage.getItem(DEBUG_INDEX_STORAGE_KEY) === '1');

  useEffect(() => {
    window.localStorage.setItem(DEBUG_INDEX_STORAGE_KEY, enabled ? '1' : '0');
  }, [enabled]);

  const value = useMemo(() => ({ enabled, toggle: () => setEnabled((prev) => !prev) }), [enabled]);

  return <DebugIndexContext.Provider value={value}>{children}</DebugIndexContext.Provider>;
};

export const useDebugIndex = () => useContext(DebugIndexContext);

export const DebugIndex: React.FC<{ indexId: string; className?: string; children: React.ReactNode }> = ({ indexId, className = '', children }) => {
  const { enabled } = useDebugIndex();

  return (
    <div className={`relative ${className}`.trim()} data-debug-id={indexId}>
      {enabled && (
        <span className="pointer-events-none absolute right-1 top-1 z-[120] rounded bg-gray-500/20 px-1 text-[8px] font-semibold leading-none text-gray-600">
          {indexId}
        </span>
      )}
      {children}
    </div>
  );
};
