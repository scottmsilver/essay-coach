import { useState, useLayoutEffect, useCallback, type RefObject } from 'react';

export function useCommentLayout(
  containerRef: RefObject<HTMLDivElement | null>,
  items: { id: string }[],
  markerAttr: string,
  activeKey?: string | null,
): Record<string, number> {
  const [positions, setPositions] = useState<Record<string, number>>({});

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container || items.length === 0) return;
    const containerRect = container.getBoundingClientRect();
    const newPositions: Record<string, number> = {};
    let lastBottom = 0;

    for (const item of items) {
      const markEl = container.querySelector(`[${markerAttr}="${item.id}"]`);
      if (!markEl) continue;

      const markRect = markEl.getBoundingClientRect();
      const idealTop = markRect.top - containerRect.top;
      const top = Math.max(idealTop, lastBottom + 8);
      newPositions[item.id] = top;

      const commentEl = container.querySelector(`[data-comment-id="${item.id}"]`) as HTMLElement | null;
      const commentHeight = commentEl ? commentEl.offsetHeight : 80;
      lastBottom = top + commentHeight;
    }

    // Ensure the sidebar is tall enough to contain all comments
    const sidebar = container.querySelector('.comment-sidebar') as HTMLElement | null;
    if (sidebar && lastBottom > 0) {
      sidebar.style.minHeight = `${lastBottom + 16}px`;
    }

    setPositions(newPositions);
  }, [containerRef, items, markerAttr]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || items.length === 0) return;

    measure();
    // Re-measure after two frames to get accurate comment heights
    // after initial positioning
    requestAnimationFrame(() => requestAnimationFrame(measure));
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items, markerAttr, measure, activeKey]);

  return positions;
}
