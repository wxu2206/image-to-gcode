import { describe, expect, it } from 'vitest';
import { formatEstimatedDuration, formatPlaybackClock } from './duration';

describe('duration formatting', () => {
  it('uses compact human-readable estimated durations', () => {
    expect(formatEstimatedDuration(0.4)).toBe('~24 sec');
    expect(formatEstimatedDuration(2.1)).toBe('~2 min');
    expect(formatEstimatedDuration(64)).toBe('~1 h 4 min');
  });

  it('formats playback clocks without decimal noise', () => {
    expect(formatPlaybackClock(0.4)).toBe('0:24');
    expect(formatPlaybackClock(64)).toBe('1:04:00');
  });
});
