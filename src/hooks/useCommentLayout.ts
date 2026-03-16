import { useState, useLayoutEffect, type RefObject } from 'react';

export function useCommentLayout(
  containerRef: RefObject<HTMLDivElement | null>,
  items: { id: string }[],
  markerAttr: string,
): Record<string, number> {
  const [positions, setPositions] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    if (!containerRef.current || items.length === 0) return;

    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
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
        const commentHeight = commentEl ? commentEl.offsetHeight : 60;
        lastBottom = top + commentHeight;
      }

      setPositions(newPositions);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [items, markerAttr]);

  return positions;
}
