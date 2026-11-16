import { afterEach, describe, expect, it, vi } from 'vitest';
import { convert } from '../core/conversion';
import { processImage } from '../core/image';
import { defaults } from '../core/machine';
import { decodeImageFile, inputFileKind, isSupportedImageFile, readImagePixels, readSvgFile, validateImageFile } from './loadImage';

const OriginalFileReader = globalThis.FileReader;
const OriginalImage = globalThis.Image;
const pngHeader = (width = 2, height = 1): ArrayBuffer => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes.buffer;
};

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
    expect(inputFileKind({ name: 'drawing.SVG', type: '' })).toBe('svg');
    expect(inputFileKind({ name: 'drawing.svg', type: 'image/svg+xml' })).toBe('svg');
    expect(inputFileKind({ name: 'no-extension', type: 'image/svg+xml' })).toBe('svg');
    expect(isSupportedImageFile({ name: 'fake.png', type: 'text/plain' })).toBe(false);
    expect(isSupportedImageFile({ name: 'fake.exe', type: 'image/svg+xml' })).toBe(false);
    expect(isSupportedImageFile({ name: 'fake.svg', type: 'text/html' })).toBe(false);
  });

  it('rejects an otherwise supported file with an unsafe resource size', () => {
    const oversized = new File(['image'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 41 * 1024 * 1024 });
    expect(() => validateImageFile(oversized)).toThrow('smaller than 40 MB');
  });

  it('reads local SVG text and applies the smaller vector upload limit', async () => {
    const selected = new File(['<svg/>'], 'safe.svg', { type: 'image/svg+xml' });
    Object.defineProperty(selected, 'text', { value: vi.fn().mockResolvedValue('<svg/>') });
    await expect(readSvgFile(selected)).resolves.toBe('<svg/>');
    const oversized = new File(['x'], 'huge.svg', { type: 'image/svg+xml' });
    Object.defineProperty(oversized, 'size', { value: 5 * 1024 * 1024 + 1 });
    expect(() => validateImageFile(oversized)).toThrow('smaller than 5 MB');
  });

  it('decodes pixels and produces usable conversion geometry', async () => {
    class SuccessfulReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      onabort: null | (() => void) = null;
      readAsArrayBuffer() { this.result = pngHeader(); this.onload?.(); }
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

  it('preserves asymmetric decoded pixel order and only inverts tone when requested', () => {
    const source = { width: 2, height: 2, data: new Uint8ClampedArray([
      10, 10, 10, 255, 40, 40, 40, 255,
      90, 90, 90, 255, 200, 200, 200, 255,
    ]) };
    const normal = processImage(source, { brightness: 0, contrast: 0, invert: false, filter: 'grayscale', threshold: 128 });
    const inverted = processImage(source, { brightness: 0, contrast: 0, invert: true, filter: 'grayscale', threshold: 128 });
    expect([...normal.data]).toEqual([10, 40, 90, 200]);
    expect([...inverted.data]).toEqual([245, 215, 165, 55]);
  });

  it('rejects a file when browser decoding fails', async () => {
    class SuccessfulReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      onabort: null | (() => void) = null;
      readAsArrayBuffer() { this.result = pngHeader(); this.onload?.(); }
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

  it('rejects excessive declared dimensions before starting the bitmap decoder', async () => {
    const readAsDataURL = vi.fn();
    class HeaderReader {
      result: ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      onabort: null | (() => void) = null;
      readAsArrayBuffer() { this.result = pngHeader(100_000, 100_000); this.onload?.(); }
      readAsDataURL = readAsDataURL;
    }
    const decoder = vi.fn();
    globalThis.FileReader = HeaderReader as unknown as typeof FileReader;
    globalThis.Image = decoder as unknown as typeof Image;
    await expect(decodeImageFile(new File(['fixture'], 'huge.png', { type: 'image/png' }))).rejects.toThrow('too many pixels');
    expect(readAsDataURL).not.toHaveBeenCalled();
    expect(decoder).not.toHaveBeenCalled();
  });
});
