import { describe, expect, it } from 'vitest';
import { parsePathData } from './pathData';

const parse = (source: string) => parsePathData(source, 'p', { commands: 0, segments: 0, maxCommands: 1_000, maxSegments: 1_000 });

describe('SVG path data', () => {
  it('supports line commands, implicit repeats, relative coordinates, and close path', () => {
    const [path] = parse('M1 2 3 4 h2 v3 l-1 -1 H0 V0 z');
    expect(path.closed).toBe(true);
    expect(path.segments.map((segment) => segment.to)).toEqual([
      { x: 3, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 7 }, { x: 4, y: 6 }, { x: 0, y: 6 }, { x: 0, y: 0 }, { x: 1, y: 2 },
    ]);
  });

  it('preserves cubic, smooth cubic, quadratic, and smooth quadratic controls', () => {
    const [path] = parse('M0 0 C1 0 2 1 3 1 S5 2 6 1 Q7 0 8 1 T10 1');
    expect(path.segments.map((segment) => segment.type)).toEqual(['cubic', 'cubic', 'quadratic', 'quadratic']);
    expect(path.segments[1]).toMatchObject({ control1: { x: 4, y: 1 }, control2: { x: 5, y: 2 } });
    expect(path.segments[3]).toMatchObject({ control: { x: 9, y: 2 } });
  });

  it('preserves absolute and relative elliptical arcs', () => {
    const paths = parse('M0 0 A5 3 30 0 1 10 0 a5 3 0 1 0 10 0');
    expect(paths[0].segments).toHaveLength(2);
    expect(paths[0].segments[0]).toMatchObject({ type: 'arc', rx: 5, ry: 3, rotation: 30, largeArc: false, sweep: true, to: { x: 10, y: 0 } });
    expect(paths[0].segments[1]).toMatchObject({ type: 'arc', largeArc: true, sweep: false, to: { x: 20, y: 0 } });
  });

  it('creates stable subpaths for repeated move commands', () => {
    const paths = parse('M0 0 L1 1 M2 2 L3 3');
    expect(paths.map((path) => path.id)).toEqual(['p-0', 'p-1']);
  });

  it('preserves a closed subpath followed by an open continuation without inventing closure', () => {
    const paths = parse('M0 0 L2 0 Z L2 2');
    expect(paths).toHaveLength(2);
    expect(paths[0].closed).toBe(true);
    expect(paths[1]).toMatchObject({ closed: false, segments: [{ from: { x: 0, y: 0 }, to: { x: 2, y: 2 } }] });
  });

  it.each(['M0 0 R1 1', 'M0 0 A2 2 0 2 0 1 1', 'M0 nope', 'L1 1'])('rejects malformed or unsupported path data %s', (source) => {
    expect(() => parse(source)).toThrow();
  });

  it('enforces command and segment budgets while parsing', () => {
    expect(() => parsePathData('M0 0 L1 0 L2 0', 'p', { commands: 0, segments: 0, maxCommands: 1, maxSegments: 1 })).toThrow(/limit exceeded/i);
  });
});
