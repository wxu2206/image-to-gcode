import { describe, expect, it } from 'vitest';
import { defaults } from './machine';
import { createSettingsUnitConverter } from './units';

describe('unit representation changes', () => {
  it('restores exact authored values after repeated switches and unrelated settings edits', () => {
    const convert = createSettingsUnitConverter();
    const original = { ...defaults, safeZ: 5, offsetX: 0.0000000000123456789 };
    let settings = original;
    for (let index = 0; index < 1_000; index += 1) {
      settings = convert(settings, 'in');
      settings = convert({ ...settings, invert: !settings.invert }, 'mm');
    }
    expect(settings).toEqual(original);
  });
  it('anchors edited inch fields independently while preserving other full-precision values', () => {
    const convert = createSettingsUnitConverter();
    const inches = convert(defaults, 'in');
    const edited = { ...inches, safeZ: 0.123456789012345, offsetX: 1e-15 };
    let settings = convert(edited, 'mm');
    expect(settings.safeZ).toBe(edited.safeZ * 25.4);
    expect(settings.feed).toBe(defaults.feed);
    for (let index = 0; index < 100; index += 1) { settings = convert(convert(settings, 'in'), 'mm'); }
    const restored = convert(settings, 'in');
    expect(restored.safeZ).toBe(edited.safeZ);
    expect(restored.offsetX).toBe(edited.offsetX);
  });
});
