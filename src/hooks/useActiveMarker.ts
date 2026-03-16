import { useState, useCallback, type RefObject } from 'react';

export function useActiveMarker(containerRef: RefObject<HTMLElement | null>) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleClick = useCallback((id: string) => {
    setActiveId(prev => {
      const next = prev === id ? null : id;
      if (next) {
        requestAnimationFrame(() => {
          const el = containerRef.current?.querySelector(`[data-comment-id="${next}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return next;
    });
  }, []);

  return [activeId, handleClick, setActiveId] as const;
}
