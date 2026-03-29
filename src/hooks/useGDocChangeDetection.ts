import { useState, useEffect, useRef } from 'react';
import type { Essay, Draft } from '../types';
import { fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';

interface GDocChangeState {
  changed: boolean;
  checking: boolean;
  lastChecked: Date | null;
}

/**
 * Periodically checks if a Google Doc has changed since the draft's content was last fetched.
 * Only runs for Google Docs essays on the latest draft.
 */
export function useGDocChangeDetection(
  essay: Essay | null,
  draft: Draft | null,
  isLatestDraft: boolean,
): GDocChangeState {
  const [state, setState] = useState<GDocChangeState>({
    changed: false,
    checking: false,
    lastChecked: null,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!essay?.contentSource || !draft || !isLatestDraft) {
      setState({ changed: false, checking: false, lastChecked: null });
      return;
    }

    const { docId, tab, sectionIndex } = essay.contentSource;

    async function check() {
      setState((s) => ({ ...s, checking: true }));
      try {
        const data = await fetchGDocInfo(docId, tab);
        const sections = parseSections(data.text, data.bookmarks);
        const currentContent = sectionIndex < sections.length ? sections[sectionIndex] : '';
        const changed = currentContent !== draft!.content;
        setState({ changed, checking: false, lastChecked: new Date() });
      } catch {
        // Silent fail — don't disrupt the UX
        setState((s) => ({ ...s, checking: false }));
      }
    }

    // Check immediately, then every 60 seconds
    check();
    intervalRef.current = setInterval(check, 60_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [essay, draft?.id, isLatestDraft]);

  return state;
}
