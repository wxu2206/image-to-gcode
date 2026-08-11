import { describe, expect, it } from 'vitest';
import { buildExportReview } from './exportReview';
import { defaults, profiles } from './machine';

const stats = { work: 10, travel: 2, total: 12, movementCount: 2, working: 1, travels: 1, toolLifts: 1, travelEfficiency: 10 / 12, time: 4, estimate: { totalMinutes: 4, workMinutes: 3, travelMinutes: 1 }, bounds: { minX: 2, maxX: 40, minY: 3, maxY: 30, minZ: null, maxZ: null } };
describe('export review', () => {
  it('reports a ready, current, in-bounds job without serializing G-code', () => {
    const review = buildExportReview({ settings: defaults, stats, profile: { ...profiles[1], toolOn: 'DOWN', toolOff: 'UP' }, warnings: [], placementPending: false, current: true });
    expect(review).toMatchObject({ level: 'ready', messages: [] });
  });
  it('blocks canonical movement bounds outside the configured machine area', () => {
    const review = buildExportReview({ settings: defaults, stats: { ...stats, bounds: { ...stats.bounds, maxX: 304 } }, profile: profiles[0], warnings: [], placementPending: false, current: true });
    expect(review.level).toBe('blocking'); expect(review.boundsMessages[0]).toContain('X exceeds maximum by 4.000');
  });
  it('blocks stale or malformed output', () => {
    expect(buildExportReview({ settings: defaults, stats, profile: profiles[0], warnings: [], placementPending: true, current: true }).level).toBe('blocking');
    expect(buildExportReview({ settings: { ...defaults, feed: -1 }, stats, profile: profiles[0], warnings: [], placementPending: false, current: true }).level).toBe('blocking');
  });
  it('accepts coordinates exactly on every inclusive machine boundary', () => {
    const boundaryStats = { ...stats, bounds: { ...stats.bounds, minX: 0, maxX: defaults.workWidth, minY: 0, maxY: defaults.workHeight } };
    expect(buildExportReview({ settings: defaults, stats: boundaryStats, profile: profiles[0], warnings: [], placementPending: false, current: true }).level).toBe('ready');
  });
});
