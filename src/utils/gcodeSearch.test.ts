import { describe, expect, it } from 'vitest';
import { visibleGcodeLines } from './gcodeSearch';

describe('inspector search windows', () => {
  it('reports unmatched, matching and cleared searches with actual line counts', () => {
    const code = 'G21\nG90\nG1 X10\nM2\n';
    expect(visibleGcodeLines(code, 'NO_MATCH_TEST')).toMatchObject({ lines: [], summary: 'No matching G-code lines' });
    expect(visibleGcodeLines(code, 'x10')).toEqual({ lines: ['G1 X10', 'M2'], start: 3, summary: 'Showing 2 lines from the match (starting at line 3)' });
    expect(visibleGcodeLines(code, '').lines).toHaveLength(4);
    expect(visibleGcodeLines('G21\nM30\n', 'x10').lines).toHaveLength(0);
  });
  it('bounds matching and unfiltered windows without counting a trailing newline as a line', () => {
    const code = Array.from({ length: 2_501 }, (_, index) => `G1 X${index}`).join('\n') + '\n';
    expect(visibleGcodeLines(code, '').lines).toHaveLength(2_000);
    expect(visibleGcodeLines(code, 'X2500').lines).toEqual(['G1 X2500']);
    expect(visibleGcodeLines(code, 'X10').lines).toHaveLength(200);
  });
});
