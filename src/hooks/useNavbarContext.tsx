import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { CoachSynthesis, EvaluationStatus, ReportKey } from '../types';

export interface ReportLoadingState {
  overall: boolean;
  grammar: boolean;
  transitions: boolean;
  prompt: boolean;
}

export interface DraftOption {
  id: string;
  label: string;
}

export interface CoachDrawerProps {
  synthesis: CoachSynthesis | null | undefined;
  synthesisStatus: EvaluationStatus | null | undefined;
  activeReport: ReportKey | null;
  onSelectReport: (key: ReportKey) => void;
  hasPrompt: boolean;
  isOwner: boolean;
  isLatestDraft: boolean;
  hasUnsavedEdits: boolean;
  draftAge: number;
  reportLoading: ReportLoadingState;
  /** Counts derived directly from analysis data (available before coach synthesis) */
  rawIssueCounts: Partial<Record<string, number>>;
  onReanalyze: () => void;
  reanalyzing: boolean;
  draftOptions: DraftOption[];
  activeDraftId: string;
  onPickDraft: (id: string) => void;
  lastSaved: Date | null;
  gdocChanged: boolean;
  gdocLastChecked: Date | null;
}

interface NavbarState {
  opened: boolean;
  drawerProps: CoachDrawerProps;
}

interface NavbarContextValue {
  state: NavbarState | null;
  set: (state: NavbarState | null) => void;
  toggle: () => void;
  setOpened: (opened: boolean) => void;
}

const NavbarCtx = createContext<NavbarContextValue>({
  state: null,
  set: () => {},
  toggle: () => {},
  setOpened: () => {},
});

export function NavbarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavbarState | null>(null);

  const toggle = useCallback(() => {
    setState((s) => s ? { ...s, opened: !s.opened } : null);
  }, []);

  const setOpened = useCallback((opened: boolean) => {
    setState((s) => s ? { ...s, opened } : null);
  }, []);

  return (
    <NavbarCtx.Provider value={{ state, set: setState, toggle, setOpened }}>
      {children}
    </NavbarCtx.Provider>
  );
}

export function useNavbarContext() {
  return useContext(NavbarCtx);
}
