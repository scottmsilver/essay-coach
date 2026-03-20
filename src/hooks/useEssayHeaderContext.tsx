import { createContext, useContext, useState, type ReactNode } from 'react';
import type { EssayHeaderContext as EssayHeaderState } from '../components/AppHeader';

interface EssayHeaderContextValue {
  state: EssayHeaderState | null;
  set: (state: EssayHeaderState | null) => void;
}

const EssayHeaderCtx = createContext<EssayHeaderContextValue>({
  state: null,
  set: () => {},
});

export function EssayHeaderProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<EssayHeaderState | null>(null);
  return (
    <EssayHeaderCtx.Provider value={{ state, set }}>
      {children}
    </EssayHeaderCtx.Provider>
  );
}

export function useEssayHeaderContext() {
  return useContext(EssayHeaderCtx).state;
}

export function useSetEssayHeader() {
  return useContext(EssayHeaderCtx).set;
}
