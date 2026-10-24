import { useEffect, useState, type RefObject } from 'react';

import { textureSetForTier, type QualityTier } from '@/core';

/**
 * What the flat map draws with: the globe's own day texture for this tier
 * (equirectangular already), returned once loaded, and the app's font,
 * written into `font` (read once, not per frame: getComputedStyle in a draw
 * forces a style pass) and again once the web fonts are in, then `onFont`.
 */
export function useMapAssets(
  tier: QualityTier,
  canvas: RefObject<HTMLCanvasElement | null>,
  font: RefObject<string>,
  onFont: () => void,
): HTMLImageElement | null {
  const [texture, setTexture] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const read = (): void => {
      if (canvas.current) font.current = getComputedStyle(canvas.current).fontFamily;
    };
    read();
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      read();
      onFont();
    });
    return () => {
      cancelled = true;
    };
  }, [canvas, font, onFont]);

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => setTexture(image);
    image.src = textureSetForTier(tier, `${import.meta.env.BASE_URL}textures`).day;
    return () => {
      image.onload = null;
    };
  }, [tier]);

  return texture;
}
