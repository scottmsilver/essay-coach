import { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { useMediaQuery } from '@mantine/hooks';
import { useNavbarContext } from '../hooks/useNavbarContext';
import MobileScorePeek from './MobileScorePeek';
import CoachDrawer from './CoachDrawer';

type SnapPoint = 'peek' | 'half' | 'full';

function getSnapValues() {
  const vh = window.innerHeight;
  return {
    peek: vh - 120,
    half: vh * 0.5,
    full: 52, // header height
  };
}

function closestSnap(y: number, snaps: ReturnType<typeof getSnapValues>): SnapPoint {
  const entries: [SnapPoint, number][] = [['peek', snaps.peek], ['half', snaps.half], ['full', snaps.full]];
  let best: SnapPoint = 'peek';
  let bestDist = Infinity;
  for (const [name, val] of entries) {
    const dist = Math.abs(y - val);
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
}

function nextSnap(current: number, direction: 'up' | 'down', snaps: ReturnType<typeof getSnapValues>): SnapPoint {
  const ordered: [SnapPoint, number][] = [['full', snaps.full], ['half', snaps.half], ['peek', snaps.peek]];
  if (direction === 'up') {
    for (const [name, val] of ordered) {
      if (val < current - 20) return name;
    }
    return 'full';
  }
  for (const [name, val] of [...ordered].reverse()) {
    if (val > current + 20) return name;
  }
  return 'peek';
}

export interface MobileCoachSheetHandle {
  snapTo: (point: SnapPoint) => void;
}

const MobileCoachSheet = forwardRef<MobileCoachSheetHandle>(function MobileCoachSheet(_, ref) {
  const { state: navbar } = useNavbarContext();
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>('peek');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const [snaps, setSnaps] = useState(getSnapValues);
  useEffect(() => {
    const onResize = () => setSnaps(getSnapValues());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [{ y }, api] = useSpring(() => ({
    y: snaps.peek,
    config: prefersReducedMotion ? { duration: 0 } : { tension: 250, friction: 30 },
  }));

  const snapTo = useCallback((point: SnapPoint) => {
    setCurrentSnap(point);
    api.start({
      y: snaps[point],
      config: prefersReducedMotion ? { duration: 0 } : { tension: 250, friction: 30 },
    });
  }, [api, snaps, prefersReducedMotion]);

  useImperativeHandle(ref, () => ({ snapTo }), [snapTo]);

  // Drag bound ONLY to the handle/peek area, not the whole sheet
  const bind = useDrag(({ event, movement: [, my], velocity: [, vy], direction: [, dy], active }) => {
    // Prevent the touch from reaching the essay text underneath
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (active) {
      api.start({ y: snaps[currentSnap] + my, immediate: true });
    } else {
      const currentY = snaps[currentSnap] + my;
      let target: SnapPoint;
      if (Math.abs(vy) > 0.5) {
        target = nextSnap(currentY, dy > 0 ? 'down' : 'up', snaps);
      } else {
        target = closestSnap(currentY, snaps);
      }
      snapTo(target);
    }
  }, {
    axis: 'y',
    filterTaps: true,
    from: () => [0, 0],
    eventOptions: { passive: false },  // required for preventDefault to work on touch events
  });

  // Snap back to peek when report is selected
  const prevReport = useRef(navbar?.meta?.activeReport);
  useEffect(() => {
    if (navbar?.meta?.activeReport && navbar.meta.activeReport !== prevReport.current) {
      prevReport.current = navbar.meta.activeReport;
      if (currentSnap !== 'peek') {
        snapTo('peek');
      }
    }
  }, [navbar?.meta?.activeReport, currentSnap, snapTo]);

  if (!navbar?.entity || !navbar?.presentation || !navbar?.editor || !navbar?.meta) {
    return null;
  }

  const backdropOpacity = y.to([snaps.full, snaps.half, snaps.peek], [0.5, 0.3, 0]);

  return (
    <>
      {/* Backdrop — tap to collapse */}
      <animated.div
        className="mobile-sheet-backdrop"
        style={{ opacity: backdropOpacity, pointerEvents: currentSnap === 'peek' ? 'none' : 'auto' }}
        onClick={() => snapTo('peek')}
      />

      {/* Sheet container — NO drag binding here */}
      <animated.div
        className="mobile-sheet"
        style={{ top: y }}
        role="dialog"
        aria-modal="true"
        aria-label="Coach feedback"
      >
        {/* DRAG HANDLE — only this area captures drag gestures */}
        <div {...bind()} className="mobile-sheet-drag-zone" style={{ touchAction: 'none' }}>
          <MobileScorePeek
            evaluation={navbar.entity.raw.evaluation}
            verdict={navbar.presentation.verdict}
          />
        </div>

        {/* Drawer content — normal touch behavior (scroll, tap) */}
        <div
          className="mobile-sheet-scroll"
          style={{
            overflowY: currentSnap === 'full' ? 'auto' : 'hidden',
            pointerEvents: currentSnap === 'peek' ? 'none' : 'auto',
          }}
        >
          <CoachDrawer
            entity={navbar.entity}
            presentation={navbar.presentation}
            editor={navbar.editor}
            meta={navbar.meta}
          />
        </div>
      </animated.div>
    </>
  );
});

export default MobileCoachSheet;
