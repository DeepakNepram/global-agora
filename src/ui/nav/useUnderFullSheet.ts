import { useLayoutEffect, useState, type RefObject } from 'react';

import { usePanelStore, useStoryStore } from '@/state';

import { SHEET_FULL_FRACTION } from '../story/sheetSpring';

/**
 * Whether a sheet at full height covers this row of the navigation. A story
 * drawn up and the library rise to 90 % of the view (Prompt 3.3), so on most
 * windows their top edge crosses the filter row. A covered row leaves the
 * screen and the Tab order rather than sit half-hidden behind the sheet with
 * its controls still reachable: axe's target-size rule found one under the
 * story's Close button on Linux's wider fonts (Prompt 5.2).
 *
 * The navigation's offset parent is the box it shares with the sheets, whose
 * full top edge is (1 − SHEET_FULL_FRACTION) of that box's height down.
 */
export function useUnderFullSheet(
  row: RefObject<HTMLElement | null>,
  navigation: RefObject<HTMLElement | null>,
): boolean {
  const storyFull = useStoryStore((state) => state.sheet === 'full');
  const libraryOpen = usePanelStore((state) => state.panel !== null);
  const raised = storyFull || libraryOpen;
  const [covered, setCovered] = useState(false);

  useLayoutEffect(() => {
    const element = row.current;
    const box = navigation.current?.offsetParent;
    if (!raised || !element || !(box instanceof HTMLElement)) return;
    const measure = (): void => {
      const bottom = element.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
      setCovered(bottom > box.clientHeight * (1 - SHEET_FULL_FRACTION));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [raised, row, navigation]);

  return raised && covered;
}
