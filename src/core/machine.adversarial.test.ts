import { beforeEach, describe, expect, it } from 'vitest';
import { defaults, loadProfiles, loadSettings, MAX_PASSES, profiles } from './machine';

beforeEach(() => localStorage.clear());

describe('adversarial persisted settings', () => {
  it('falls back field-by-field for negative, huge, non-finite-like, and unknown values', () => {
    localStorage.setItem('i2g-settings', JSON.stringify({
      workWidth: -1,
      workHeight: 9e99,
      outputWidth: null,
      passes: MAX_PASSES + 1,
      precision: 1.5,
      threshold: 999,
      toolpathDetail: -2,
      noiseCleanup: 'dangerous',
      feed: 'Infinity',
      origin: 'diagonal',
      filter: 'script',
      __proto__: { polluted: true },
      constructor: { prototype: { polluted: true } },
    }));
    const loaded = loadSettings();
    expect(loaded).toMatchObject({
      workWidth: defaults.workWidth,
      workHeight: defaults.workHeight,
      outputWidth: defaults.outputWidth,
      passes: defaults.passes,
      precision: defaults.precision,
      threshold: defaults.threshold,
      toolpathDetail: defaults.toolpathDetail,
      noiseCleanup: defaults.noiseCleanup,
      feed: defaults.feed,
      origin: defaults.origin,
      filter: defaults.filter,
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('reconstructs only valid custom profile fields and repairs unsafe pass depth', () => {
    localStorage.setItem('i2g-profiles', JSON.stringify([
      { id: 'unsafe', name: 'Unsafe', kind: 'cnc', header: 'G91', footer: 'M2', toolOn: 'M3', toolOff: 'M5', safeZ: 5, workZ: -1, passDepth: -500, feed: -1, travel: 'fast', prototype: { polluted: true } },
      { id: '__proto__', name: '<img src=x onerror=alert(1)>', kind: 'pen', header: '<script>', footer: '', toolOn: 'DOWN', toolOff: 'UP', safeZ: 0, workZ: 0, passDepth: 1, feed: 100, travel: 200 },
    ]));
    const loaded = loadProfiles();
    expect(loaded.find((profile) => profile.id === 'unsafe')).toMatchObject({ passDepth: 1, feed: defaults.feed, travel: defaults.travel, postProcessorId: 'generic' });
    expect(loaded.find((profile) => profile.id === '__proto__')).toMatchObject({ name: '<img src=x onerror=alert(1)>', header: '<script>', postProcessorId: 'generic' });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('preserves old profile fields while migrating absent or malformed processor IDs conservatively', () => {
    localStorage.setItem('i2g-profiles', JSON.stringify([
      { id: 'old-pen', name: 'Old Pen', kind: 'pen', header: 'G90', footer: 'M2', toolOn: 'DOWN', toolOff: 'UP', safeZ: 0, workZ: 0, passDepth: 1, feed: 321, travel: 654 },
      { id: 'bad-id', name: 'Bad ID', kind: 'laser', postProcessorId: '__proto__', header: '', footer: 'M2', toolOn: 'ON', toolOff: 'OFF', safeZ: 0, workZ: 0, passDepth: 1, feed: 111, travel: 222 },
      { id: 'marlin', name: 'Marlin', kind: 'laser', postProcessorId: 'marlin-pen', header: '', footer: '', toolOn: 'DOWN', toolOff: 'UP', safeZ: 0, workZ: 0, passDepth: 1, feed: 500, travel: 700 },
    ]));
    const loaded = loadProfiles();
    expect(loaded.find((profile) => profile.id === 'old-pen')).toMatchObject({ postProcessorId: 'generic', header: 'G90', toolOn: 'DOWN', feed: 321, travel: 654 });
    expect(loaded.find((profile) => profile.id === 'bad-id')).toMatchObject({ postProcessorId: 'generic', kind: 'laser', toolOff: 'OFF' });
    expect(loaded.find((profile) => profile.id === 'marlin')).toMatchObject({ postProcessorId: 'marlin-pen', kind: 'pen', toolOn: 'DOWN' });
  });

  it('caps persisted custom profiles to bound rendering and parsing work', () => {
    const custom = Array.from({ length: 150 }, (_, index) => ({
      id: `custom-${index}`,
      name: `Custom ${index}`,
      kind: 'pen',
      header: '',
      footer: '',
      toolOn: '',
      toolOff: '',
      safeZ: 0,
      workZ: 0,
      passDepth: 1,
      feed: 100,
      travel: 200,
    }));
    localStorage.setItem('i2g-profiles', JSON.stringify(custom));
    expect(loadProfiles()).toHaveLength(profiles.length + 100);
  });
});
