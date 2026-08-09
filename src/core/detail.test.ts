import { describe, expect, it } from 'vitest';
import { contour, raster } from './conversion';
import { detailResolution, resampleForToolpath } from './detail';
import { defaults, loadProfiles, loadSettings } from './machine';

const settings = { ...defaults, outputWidth: 100, outputHeight: 50, lineSpacing: .5, threshold: 128, simplify: .1 };
const darkImage = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height) });

describe('physical toolpath detail', () => {
  it('migrates older local settings to physical detail and preview defaults', () => {
    localStorage.setItem('i2g-settings', JSON.stringify({ outputWidth: 220 }));
    expect(loadSettings()).toMatchObject({ outputWidth: 220, toolpathDetail: .3, previewQuality: 'balanced' });
    localStorage.removeItem('i2g-settings');
  });
  it('reconstructs known settings fields from malformed local storage without inheriting junk', () => {
    localStorage.setItem('i2g-settings', JSON.stringify({ outputWidth: 'wide', feed: Infinity, invert: 'yes', units: 'nope', __proto__: { polluted: true } }));
    expect(loadSettings()).toMatchObject({ outputWidth: defaults.outputWidth, feed: defaults.feed, invert: defaults.invert, units: defaults.units });
    localStorage.setItem('i2g-profiles', JSON.stringify([{ id: 'bad', name: 7 }, { id: 'custom', name: 'Safe', kind: 'pen', header: '<script>', footer: '', toolOn: '', toolOff: '', safeZ: 0, workZ: 0, passDepth: 1, feed: 100, travel: 200 }]));
    expect(loadProfiles().map((profile) => profile.id)).toContain('custom');
    expect(loadProfiles().map((profile) => profile.id)).not.toContain('bad');
    localStorage.removeItem('i2g-settings'); localStorage.removeItem('i2g-profiles');
  });
  it('derives useful samples from output millimetres without changing requested dimensions', () => {
    const source = darkImage(1000, 500);
    expect(detailResolution(source, { ...settings, toolpathDetail: .1 })).toMatchObject({ width: 1000, height: 500, physicalWidthMm: 100, physicalHeightMm: 50 });
    expect(detailResolution(source, { ...settings, toolpathDetail: .5 })).toMatchObject({ width: 200, height: 100, physicalWidthMm: 100, physicalHeightMm: 50 });
  });
  it('keeps detail in physical units when placement is resized', () => {
    const source = darkImage(1000, 500);
    const resized = detailResolution(source, { ...settings, outputWidth: 200, outputHeight: 100, toolpathDetail: .5 });
    expect(resized).toMatchObject({ width: 400, height: 200, physicalWidthMm: 200, physicalHeightMm: 100 });
  });

  it('reduces dense raster geometry as detail becomes physically coarser', () => {
    const source = darkImage(1000, 500);
    const fine = resampleForToolpath(source, { ...settings, toolpathDetail: .1 });
    const coarse = resampleForToolpath(source, { ...settings, toolpathDetail: .5 });
    const finePath = raster(fine, { ...settings, toolpathDetail: .1 });
    const coarsePath = raster(coarse, { ...settings, toolpathDetail: .5 });
    const points = (paths: typeof finePath.paths) => paths.reduce((total, path) => total + path.points.length, 0);
    expect(finePath.width).toBe(1000);
    expect(coarsePath.width).toBe(200);
    expect(points(coarsePath.paths)).toBeLessThan(points(finePath.paths));
    expect(settings.outputWidth).toBe(100);
    expect(settings.outputHeight).toBe(50);
  });

  it('simplifies contour geometry in output units while retaining closed deterministic loops', () => {
    const width = 48;
    const height = 48;
    const image = { width, height, data: new Uint8ClampedArray(width * height).fill(255) };
    for (let y = 8; y < 40; y += 1) {
      for (let x = 4; x < 44; x += 1) if (y >= 8 + x % 5) image.data[y * width + x] = 0;
    }
    const fine = contour(image, { ...settings, outputWidth: 48, outputHeight: 48, toolpathDetail: .1 });
    const coarse = contour(image, { ...settings, outputWidth: 48, outputHeight: 48, toolpathDetail: 1 });
    const count = (paths: typeof fine.paths) => paths.reduce((total, path) => total + path.points.length, 0);
    expect(count(coarse.paths)).toBeLessThanOrEqual(count(fine.paths));
    expect(coarse.paths.every((path) => path.points[0].x === path.points[path.points.length - 1].x && path.points[0].y === path.points[path.points.length - 1].y)).toBe(true);
    expect(contour(image, { ...settings, outputWidth: 48, outputHeight: 48, toolpathDetail: 1 }).paths).toEqual(coarse.paths);
  });
});
