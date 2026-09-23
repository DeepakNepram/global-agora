import { Texture } from 'three';
import { describe, expect, it } from 'vitest';

import { previewTextureSet, textureSetForTier, type TextureLayer } from '@/core';

import { loadEarthTextures, type LoadTexture } from './textureLoading';

interface Request {
  readonly url: string;
  readonly texture: Texture;
  readonly load: () => void;
  readonly fail: () => void;
}

/** Records every request; the test decides when each one lands. */
function fakeLoader(): {
  requests: Request[];
  loadTexture: LoadTexture;
  find(url: string): Request;
} {
  const requests: Request[] = [];
  const loadTexture: LoadTexture = (url, onLoad, onError) => {
    const texture = new Texture();
    requests.push({
      url,
      texture,
      load: () => onLoad(texture),
      fail: () => onError(new Error(url)),
    });
    return texture;
  };
  const find = (url: string): Request => {
    const request = requests.find((r) => r.url === url);
    if (!request) throw new Error(`${url} was not requested`);
    return request;
  };
  return { requests, loadTexture, find };
}

function disposed(texture: Texture): () => boolean {
  let flag = false;
  texture.addEventListener('dispose', () => {
    flag = true;
  });
  return () => flag;
}

const MEDIUM = textureSetForTier('medium');
const PREVIEW = previewTextureSet();

function start(preview: Partial<Record<TextureLayer, string>> = PREVIEW) {
  const fake = fakeLoader();
  const loaded: TextureLayer[] = [];
  const textures = loadEarthTextures(MEDIUM, {
    maxAnisotropy: 16,
    onLoad: (layer) => loaded.push(layer),
    onError: () => {},
    preview,
    loadTexture: fake.loadTexture,
  });
  return { ...fake, loaded, textures };
}

describe('loadEarthTextures', () => {
  it('asks for the previews and only the full day map at first', () => {
    const { requests } = start();
    expect(requests.map((r) => r.url)).toEqual([PREVIEW.day, PREVIEW.night, MEDIUM.day]);
  });

  it('gives the full day map the connection, then night and clouds, then specular', () => {
    const { requests, find } = start();
    find(MEDIUM.day).load();
    expect(requests.map((r) => r.url).slice(3)).toEqual([MEDIUM.night, MEDIUM.clouds]);
    find(MEDIUM.night).load();
    expect(requests).toHaveLength(5);
    find(MEDIUM.clouds).load();
    expect(requests.map((r) => r.url).at(-1)).toBe(MEDIUM.specular);
  });

  it('draws the preview, then swaps in the full map and disposes the preview', () => {
    const { find, loaded, textures } = start();
    const preview = find(PREVIEW.day);
    const previewDisposed = disposed(preview.texture);
    expect(textures.slots.day.value).toBe(preview.texture);

    preview.load();
    expect(loaded).toEqual(['day']);

    const full = find(MEDIUM.day);
    full.load();
    expect(textures.slots.day.value).toBe(full.texture);
    expect(previewDisposed()).toBe(true);
    expect(loaded).toEqual(['day', 'day']);
  });

  it('ignores a preview that lands after its full map', () => {
    const { find, loaded, textures } = start();
    const full = find(MEDIUM.day);
    full.load();
    find(PREVIEW.day).load();
    expect(textures.slots.day.value).toBe(full.texture);
    expect(loaded).toEqual(['day']);
  });

  it('moves on to the next stage when a map fails', () => {
    const { requests, find } = start();
    find(MEDIUM.day).fail();
    expect(requests.map((r) => r.url)).toContain(MEDIUM.night);
  });

  it('asks for no preview on LOW, where the preview is the final map', () => {
    const fake = fakeLoader();
    loadEarthTextures(textureSetForTier('low'), {
      maxAnisotropy: 1,
      onLoad: () => {},
      preview: PREVIEW,
      loadTexture: fake.loadTexture,
    });
    expect(fake.requests.map((r) => r.url)).toEqual([textureSetForTier('low').day]);
  });

  it('draws black until the full map when there is no preview', () => {
    const { requests, textures } = start({});
    expect(requests.map((r) => r.url)).toEqual([MEDIUM.day]);
    expect(textures.slots.day.value.image).toBeNull();
  });

  it('disposes everything and starts no later stage after dispose', () => {
    const { requests, find, textures } = start();
    const preview = disposed(find(PREVIEW.night).texture);
    textures.dispose();
    find(MEDIUM.day).load();
    expect(preview()).toBe(true);
    expect(requests).toHaveLength(3);
  });
});
