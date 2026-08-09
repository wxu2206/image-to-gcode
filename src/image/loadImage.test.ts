import { afterEach, describe, expect, it, vi } from 'vitest';
import { convert } from '../core/conversion';
import { processImage } from '../core/image';
import { defaults } from '../core/machine';
import { decodeImageFile, isSupportedImageFile, readImagePixels } from './loadImage';

const OriginalFileReader = globalThis.FileReader;
const OriginalImage = globalThis.Image;

afterEach(() => {
  globalThis.FileReader = OriginalFileReader;
  globalThis.Image = OriginalImage;
  vi.restoreAllMocks();
});

describe('image loading pipeline', () => {
  it('recognizes supported MIME types and extension fallback', () => {
    expect(isSupportedImageFile({ name: 'photo.JPG', type: '' })).toBe(true);
    expect(isSupportedImageFile({ name: 'photo.jpeg', type: 'image/jpeg' })).toBe(true);
    expect(isSupportedImageFile({ name: 'image.webp', type: 'image/webp' })).toBe(true);
    expect(isSupportedImageFile({ name: 'fake.png', type: 'text/plain' })).toBe(false);
  });

  it('decodes pixels and produces usable conversion geometry', async () => {
    class SuccessfulReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      onabort: null | (() => void) = null;
      readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload?.(); }
    }
    class SuccessfulImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      naturalWidth = 2;
      naturalHeight = 1;
      width = 2;
      height = 1;
      set src(_value: string) { this.onload?.(); }
    }
    globalThis.FileReader = SuccessfulReader as unknown as typeof FileReader;
    globalThis.Image = SuccessfulImage as unknown as typeof Image;
    const pixels = { data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]), width: 2, height: 1, colorSpace: 'srgb' } as ImageData;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => pixels } as unknown as CanvasRenderingContext2D);

    const decoded = await decodeImageFile(new File(['png'], 'valid image.png', { type: 'image/png' }));
    const source = readImagePixels(decoded);
    const processed = processImage(source, { brightness: 0, contrast: 0, invert: false, filter: 'grayscale', threshold: 128 });
    const toolpath = convert(processed, { ...defaults, outputHeight: 1, lineSpacing: 1 }, 'raster');
    expect(decoded.naturalWidth).toBe(2);
    expect(processed.data).toEqual(new Uint8ClampedArray([0, 0]));
    expect(toolpath.paths).toHaveLength(1);
  });

  it('rejects a file when browser decoding fails', async () => {
    class SuccessfulReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      onabort: null | (() => void) = null;
      readAsDataURL() { this.result = 'data:image/png;base64,broken'; this.onload?.(); }
    }
    class FailedImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { this.onerror?.(); }
    }
    globalThis.FileReader = SuccessfulReader as unknown as typeof FileReader;
    globalThis.Image = FailedImage as unknown as typeof Image;
    await expect(decodeImageFile(new File(['broken'], 'broken.png', { type: 'image/png' }))).rejects.toThrow('not a valid or supported image');
  });
});
