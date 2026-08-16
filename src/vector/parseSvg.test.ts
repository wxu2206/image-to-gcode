import { describe, expect, it } from 'vitest';
import unsafeSvg from './fixtures/adversarial.svg?raw';
import malformedSvg from './fixtures/malformed.svg?raw';
import { transformVectorPoint } from './affine';
import { parseSvgText } from './parseSvg';

const svg = (body: string, attributes = 'viewBox="0 0 100 50" width="200" height="100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;

describe('secure SVG parsing', () => {
  it('extracts all supported basic geometry into a DOM-free numeric model', () => {
    const document = parseSvgText(svg(`
      <line x1="0" y1="0" x2="10" y2="10" stroke="black" />
      <polyline points="0,0 5,5 10,0" fill="none" stroke="black" />
      <polygon points="20,0 30,0 25,10" />
      <rect x="40" y="0" width="10" height="10" rx="2" ry="3" />
      <circle cx="60" cy="5" r="5" /><ellipse cx="80" cy="5" rx="8" ry="4" />
    `));
    expect(document.paths).toHaveLength(6);
    expect(document.paths.map((path) => path.closed)).toEqual([false, false, true, true, true, true]);
    expect(document.paths[3].segments.filter((segment) => segment.type === 'arc')).toHaveLength(4);
    expect(document.paths[4].segments).toHaveLength(4);
    expect(document.segmentCount).toBe(document.paths.reduce((total, path) => total + path.segments.length, 0));
  });

  it('maps a viewBox with default meet alignment and preserveAspectRatio none', () => {
    const meet = parseSvgText(svg('<line x1="0" y1="0" x2="100" y2="50" stroke="black" />', 'viewBox="0 0 100 50" width="300" height="100"'));
    expect(transformVectorPoint(meet.paths[0].transform, { x: 0, y: 0 })).toEqual({ x: 50, y: 0 });
    expect(transformVectorPoint(meet.paths[0].transform, { x: 100, y: 50 })).toEqual({ x: 250, y: 100 });
    const none = parseSvgText(svg('<line x1="0" y1="0" x2="100" y2="50" stroke="black" />', 'viewBox="0 0 100 50" width="300" height="100" preserveAspectRatio="none"'));
    expect(transformVectorPoint(none.paths[0].transform, { x: 100, y: 50 })).toEqual({ x: 300, y: 100 });
  });

  it('supports physical root dimensions and derives a missing dimension from viewBox', () => {
    const physical = parseSvgText(svg('<path d="M0 0L1 1" stroke="black" />', 'viewBox="0 0 10 5" width="25.4mm" height="1in"'));
    expect(physical.width).toBeCloseTo(96);
    expect(physical.height).toBeCloseTo(96);
    const derived = parseSvgText(svg('<path d="M0 0L1 1" stroke="black" />', 'viewBox="0 0 10 5" width="100"'));
    expect(derived.height).toBe(50);
  });

  it('composes nested groups, nested SVG viewports, rotation, scale, and matrices', () => {
    const document = parseSvgText(svg('<g transform="translate(10 5)"><g transform="scale(2)"><line x1="1" y1="2" x2="3" y2="4" stroke="black" /></g></g>', 'width="100" height="50"'));
    expect(transformVectorPoint(document.paths[0].transform, { x: 1, y: 2 })).toEqual({ x: 12, y: 9 });
    const nested = parseSvgText(svg('<svg x="10" y="5" width="20" height="10" viewBox="0 0 2 1"><line x1="0" y1="0" x2="2" y2="1" stroke="black" /></svg>'));
    expect(transformVectorPoint(nested.paths[0].transform, { x: 2, y: 1 })).toEqual({ x: 60, y: 30 });
  });

  it('imports stroke centerlines and explicitly warns about fill semantics', () => {
    const document = parseSvgText(svg('<path d="M0 0 L10 0 L10 10" fill="red"/><path d="M20 0 L30 0" fill="red" stroke="blue" stroke-width="4"/>'));
    expect(document.paths[0].closed).toBe(true);
    expect(document.paths[1].strokeWidth).toBe(4);
    expect(document.warnings).toContain('Fill-only SVG geometry was imported as an outline; fill hatching is not supported.');
    expect(document.warnings).toContain('SVG fills are not hatched; stroked geometry was imported as centerlines.');
  });

  it('deduplicates unsupported and unsafe feature warnings and retains only safe geometry', () => {
    const document = parseSvgText(unsafeSvg);
    expect(document.paths).toHaveLength(1);
    expect(document.warnings.some((warning) => /script/i.test(warning))).toBe(true);
    expect(document.warnings.some((warning) => /event-handler/i.test(warning))).toBe(true);
    expect(document.warnings.some((warning) => /external|unsafe/i.test(warning))).toBe(true);
    expect(document.warnings.some((warning) => /foreignObject/i.test(warning))).toBe(true);
    expect(document.warnings.some((warning) => /text/i.test(warning))).toBe(true);
    expect(new Set(document.warnings).size).toBe(document.warnings.length);
    expect(JSON.stringify(document)).not.toContain('<script');
  });

  it('ignores external stylesheet processing instructions without fetching them', () => {
    const document = parseSvgText(`<?xml-stylesheet href="https://example.invalid/theme.css"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><line x2="10" y2="10" stroke="black"/></svg>`);
    expect(document.paths).toHaveLength(1);
    expect(document.warnings).toContain('External SVG stylesheets are not supported and were ignored.');
  });

  it.each([
    ['malformed XML', malformedSvg, /malformed XML/i],
    ['DOCTYPE', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', /DOCTYPE/i],
    ['zero dimensions', svg('<line/>', 'width="0" height="10"'), /greater than zero/i],
    ['unsupported units', svg('<line/>', 'width="10em" height="10"'), /unsupported SVG dimension unit/i],
    ['non-finite path data', svg('<path d="M0 0 L1e999 2"/>'), /no supported visible vector geometry|non-finite/i],
  ])('rejects %s safely', (_name, source, expected) => {
    expect(() => parseSvgText(source)).toThrow(expected);
  });

  it('warns and skips malformed geometry or transforms without failing valid siblings', () => {
    const document = parseSvgText(svg('<path d="M0 bad"/><line transform="scale()"/><line x2="2" y2="2" stroke="black"/>'));
    expect(document.paths).toHaveLength(1);
    expect(document.warnings.some((warning) => /malformed|missing|transform/i.test(warning))).toBe(true);
  });

  it('enforces iterative node, depth, command, and segment safety limits', () => {
    const nested = `${'<g>'.repeat(6)}<line x2="1" y2="1" stroke="black"/>${'</g>'.repeat(6)}`;
    expect(() => parseSvgText(svg(nested), { maxNodes: 100, maxDepth: 3, maxPathCommands: 100, maxSegments: 100 })).toThrow(/depth limit/i);
    expect(() => parseSvgText(svg('<line/><line/><line/>'), { maxNodes: 2, maxDepth: 3, maxPathCommands: 100, maxSegments: 100 })).toThrow(/node limit/i);
    expect(() => parseSvgText(svg('<path d="M0 0 L1 0 L2 0 L3 0"/>'), { maxNodes: 10, maxDepth: 3, maxPathCommands: 2, maxSegments: 2 })).toThrow(/limit exceeded/i);
    const hugePoints = Array.from({ length: 80 }, (_, index) => `${index},${index % 10}`).join(' ');
    expect(() => parseSvgText(svg(`<polygon points="${hugePoints}"/>`), { maxNodes: 10, maxDepth: 3, maxPathCommands: 50, maxSegments: 50 })).toThrow(/limit exceeded/i);
  });

  it('is deterministic, including stable IDs and warnings', () => {
    const source = svg('<text>ignored</text><path d="M0 0L10 0 M20 0L30 0" stroke="black"/>');
    expect(parseSvgText(source)).toEqual(parseSvgText(source));
    expect(parseSvgText(source).paths.map((path) => path.id)).toEqual(['v3-0', 'v3-1']);
  });
});
