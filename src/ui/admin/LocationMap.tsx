import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import type { LatLon } from '@/core';
import {
  latLonToPoint,
  nudge,
  panBy,
  pointToLatLon,
  sourceRect,
  viewAt,
  WORLD_VIEW,
  zoomAt,
  type MapSize,
  type MapView,
} from '@/core/mapView';

import { SECONDARY } from '../account/accountStyles';

export interface LocationMapProps {
  /** Where the pin is now. */
  readonly pin: LatLon;
  /** Where the story was before: drawn hollow, so the move shows. */
  readonly was: LatLon;
  onPick(at: LatLon): void;
}

/** The globe's own day texture (NASA, equirectangular), 640 KB, fetched only on this tab. */
const TEXTURE = `${import.meta.env.BASE_URL}textures/day-4096.webp`;
/** Opening view: a few hundred kilometres across, enough to see the city. */
const START_ZOOM = 12;
/** Pointer travel under this is a click, not a drag. */
const CLICK_SLOP_PX = 4;

/**
 * A flat map to put a story's pin on (Prompt 4.6). The canvas draws only the
 * texels in view, at any zoom. Click places the pin, drag pans, the wheel and
 * the buttons zoom; with the map focused, the arrow keys move the pin (Shift
 * ten times as far) and + and − zoom.
 */
export function LocationMap({ pin, was, onPick }: LocationMapProps): JSX.Element {
  const helpId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<MapSize>({ width: 0, height: 0 });
  const [view, setView] = useState<MapView>(() => viewAt(pin, START_ZOOM));
  const [texture, setTexture] = useState<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => setTexture(image);
    image.src = TEXTURE;
  }, []);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Draws on demand: only when the view, the size or the texture changes.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    context.fillStyle = '#0b1a2b';
    context.fillRect(0, 0, element.width, element.height);
    if (texture === null) return;
    const rect = sourceRect(view, { width: texture.naturalWidth, height: texture.naturalHeight });
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      texture,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      element.width,
      element.height,
    );
  }, [view, size, texture]);

  // The wheel zooms the map, not the page: React's wheel listener is passive.
  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      const factor = Math.exp(-event.deltaY * 0.002);
      setView((current) =>
        zoomAt(current, factor, point, { width: box.width, height: box.height }),
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const centre = { x: size.width / 2, y: size.height / 2 };
  const zoomBy = (factor: number): void =>
    setView((current) => zoomAt(current, factor, centre, size));

  /** Moves the pin, and the map with it if the pin would leave the frame. */
  const pick = (at: LatLon): void => {
    onPick(at);
    const point = latLonToPoint(view, at, size);
    const inside = point.x >= 0 && point.x <= size.width && point.y >= 0 && point.y <= size.height;
    if (!inside) setView(viewAt(at, view.zoom));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move !== undefined) pick(nudge(pin, view, move[0], move[1]));
    else if (event.key === '+' || event.key === '=') zoomBy(2);
    else if (event.key === '-' || event.key === '_') zoomBy(0.5);
    else return;
    event.preventDefault();
  };

  const marker = (at: LatLon) => latLonToPoint(view, at, size);
  const now = marker(pin);
  const before = marker(was);
  const moved = Math.abs(now.x - before.x) > 1 || Math.abs(now.y - before.y) > 1;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        role="application"
        tabIndex={0}
        aria-label="Map. Click to place the pin."
        aria-describedby={helpId}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start === null) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
          drag.current = { x: event.clientX, y: event.clientY, moved: true };
          setView((current) => panBy(current, dx, dy, size));
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (start === null || start.moved) return;
          const box = event.currentTarget.getBoundingClientRect();
          pick(
            pointToLatLon(view, { x: event.clientX - box.left, y: event.clientY - box.top }, size),
          );
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        className="relative aspect-[2/1] w-full cursor-crosshair touch-none select-none overflow-hidden rounded-lg bg-[#0b1a2b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        {moved && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-white/70"
            style={{ left: before.x, top: before.y }}
          />
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-void bg-accent shadow"
          style={{ left: now.x, top: now.y }}
        />
      </div>
      <p id={helpId} className="text-xs text-muted">
        Drag to move the map, scroll or use the buttons to zoom. With the map focused, arrow keys
        move the pin (Shift: ten times as far), + and − zoom.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SECONDARY} onClick={() => zoomBy(2)}>
          Zoom in
        </button>
        <button type="button" className={SECONDARY} onClick={() => zoomBy(0.5)}>
          Zoom out
        </button>
        <button type="button" className={SECONDARY} onClick={() => setView(viewAt(pin, view.zoom))}>
          Centre on the pin
        </button>
        <button type="button" className={SECONDARY} onClick={() => setView(WORLD_VIEW)}>
          Whole world
        </button>
      </div>
    </div>
  );
}
