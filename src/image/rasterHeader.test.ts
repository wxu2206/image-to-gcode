import { describe, expect, it } from 'vitest';
import { validateRasterHeader } from './rasterHeader';

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
};
const jpeg = (width: number, height: number, marker = 0xc0) => Uint8Array.of(
  0xff, 0xd8, 0xff, 0xe1, 0, 6, 1, 2, 3, 4,
  0xff, marker, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1,
);
const chunk = (name: string, payload: Uint8Array) => {
  const bytes = new Uint8Array(8 + payload.length + (payload.length & 1));
  bytes.set(Array.from(name, (c) => c.charCodeAt(0)));
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
};
const webp = (...chunks: Uint8Array[]) => {
  const bytes = new Uint8Array(12 + chunks.reduce((n, c) => n + c.length, 0));
  bytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  let offset = 12;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  return bytes;
};
const vp8 = (width: number, height: number) => chunk('VP8 ', Uint8Array.of(
  0, 0, 0, 0x9d, 1, 0x2a, width & 255, width >> 8, height & 255, height >> 8,
));
const vp8l = (width: number, height: number) => {
  const bits = (width - 1) | ((height - 1) << 14);
  return chunk('VP8L', Uint8Array.of(0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, bits >> 24));
};
const vp8x = (width: number, height: number) => {
  const bytes = new Uint8Array(10);
  for (let i = 0; i < 3; i += 1) { bytes[4 + i] = (width - 1) >> (8 * i); bytes[7 + i] = (height - 1) >> (8 * i); }
  return chunk('VP8X', bytes);
};

describe('pre-decode raster dimensions', () => {
  it.each([png(200, 100), png(48_000, 1000), jpeg(400, 300), jpeg(400, 300, 0xc2),
    webp(vp8(400, 300)), webp(vp8l(400, 300)), webp(vp8x(400, 300), vp8l(400, 300))])(
    'accepts bounded PNG, JPEG, and all three WebP header types', (bytes) => {
      expect(() => validateRasterHeader(bytes)).not.toThrow();
    },
  );
  it.each([png(100_000, 100_000), jpeg(16_000, 16_000), webp(vp8(16_000, 16_000)),
    webp(vp8l(16_000, 16_000)), webp(vp8x(100_000, 100_000)),
    webp(vp8x(10, 10), vp8l(16_000, 16_000))])('rejects excessive dimensions in any bitmap chunk', (bytes) => {
    expect(() => validateRasterHeader(bytes)).toThrow('too many pixels');
  });
  it.each([new Uint8Array(), new TextEncoder().encode('<svg/>'), png(0, 1), jpeg(1, 1).slice(0, 17),
    webp(vp8l(10, 10)).slice(0, 20), Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 0)])(
    'rejects unsupported, empty, and truncated headers', (bytes) => {
      expect(() => validateRasterHeader(bytes)).toThrow();
    },
  );
  it('checks animated WebP frame dimensions as well as its canvas', () => {
    const nested = vp8l(10, 10), frame = new Uint8Array(16 + nested.length);
    frame.set([0x7f, 0x3e, 0], 6); frame.set([0x7f, 0x3e, 0], 9);
    frame.set(nested, 16);
    expect(() => validateRasterHeader(webp(vp8x(10, 10), chunk('ANMF', frame)))).toThrow('too many pixels');
  });
});
