import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ReportKey } from '../types';
import type { DraftEntity } from '../entities/draftEntity';
import type { DraftPresentation } from '../entities/draftPresentation';
import type { DraftEditorState } from './useDraftEditor';
import type { AnalysisActions } from './useAnalysisActions';

export interface DraftOption {
  id: string;
  label: string;
}

export interface NavbarMeta {
  activeReport: ReportKey;
  onSelectReport: (key: ReportKey) => void;
  draftOptions: DraftOption[];
  onPickDraft: (id: string) => void;
  onReanalyze: () => void;
  reanalyzing: boolean;
  gdocChanged: boolean;
  gdocLastChecked: Date | null;
}

export interface NavbarState {
  opened: boolean;
  entity: DraftEntity | null;
  presentation: DraftPresentation | null;
  editor: DraftEditorState | null;
  actions: AnalysisActions | null;
  meta: NavbarMeta | null;
}

interface NavbarContextValue {
  state: NavbarState | null;
  /** Update data without stomping `opened` */
  updateData: (data: Omit<NavbarState, 'opened'>) => void;
  /** Set the full state (used for init/cleanup) */
  set: (state: NavbarState | null) => void;
  toggle: () => void;
  setOpened: (opened: boolean) => void;
}

const NavbarCtx = createContext<NavbarContextValue>({
  state: null,
  updateData: () => {},
  set: () => {},
  toggle: () => {},
  setOpened: () => {},
});

export function NavbarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavbarState | null>(null);

  const updateData = useCallback((data: Omit<NavbarState, 'opened'>) => {
    setState((prev) => prev ? { ...prev, ...data } : { opened: true, ...data });
  }, []);

  const toggle = useCallback(() => {
    setState((s) => s ? { ...s, opened: !s.opened } : null);
  }, []);

  const setOpened = useCallback((opened: boolean) => {
    setState((s) => s ? { ...s, opened } : null);
  }, []);

  return (
    <NavbarCtx.Provider value={{ state, updateData, set: setState, toggle, setOpened }}>
      {children}
    </NavbarCtx.Provider>
  );
}

export function useNavbarContext() {
  return useContext(NavbarCtx);
}
