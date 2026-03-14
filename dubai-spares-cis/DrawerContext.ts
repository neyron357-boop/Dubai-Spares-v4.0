import { createContext, useContext } from 'react';

interface DrawerContextValue {
  openMenu: () => void;
}

export const DrawerContext = createContext<DrawerContextValue>({ openMenu: () => {} });

export const useDrawer = (): DrawerContextValue => useContext(DrawerContext);
