import { IDENTITY_MATRIX, multiplyAffine, parseSvgTransform } from './affine';
import type { AffineMatrix, VectorDocument, VectorParseLimits, VectorPath, VectorPoint, VectorSegment } from './model';
import { DEFAULT_VECTOR_PARSE_LIMITS } from './model';
import { parsePathData } from './pathData';

type ViewBox = { minX: number; minY: number; width: number; height: number };
type PaintState = { stroke: string; fill: string; strokeWidth: number; hidden: boolean };
type StackEntry = { element: Element; matrix: AffineMatrix; paint: PaintState; depth: number; root: boolean };

const numeric = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?$/;
const lengthPattern = /^([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)([a-zA-Z%]*)$/;
const point = (x: number, y: number): VectorPoint => ({ x, y });
const samePoint = (a: VectorPoint, b: VectorPoint) => a.x === b.x && a.y === b.y;
const excerpt = (value: string) => value.length <= 256 ? value : `${value.slice(0, 253)}…`;

function finiteNumber(value: string | null, fallback?: number): number {
  if (value === null || value.trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Required SVG numeric attribute is missing.');
  }
  if (!numeric.test(value.trim())) throw new Error(`SVG numeric value “${excerpt(value)}” is malformed.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('SVG contains a non-finite numeric value.');
  return parsed;
}

function svgLength(value: string | null, fallback?: number): number {
  if (value === null || value.trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Required SVG dimension is missing.');
  }
  const match = lengthPattern.exec(value.trim());
  if (!match) throw new Error(`SVG dimension “${excerpt(value)}” is malformed.`);
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) throw new Error('SVG contains a non-finite dimension.');
  const unit = match[2].toLowerCase();
  const factor = unit === '' || unit === 'px' ? 1
    : unit === 'in' ? 96
      : unit === 'cm' ? 96 / 2.54
        : unit === 'mm' ? 96 / 25.4
          : unit === 'pt' ? 96 / 72
            : unit === 'pc' ? 16
              : null;
  if (factor === null) throw new Error(`Unsupported SVG dimension unit “${unit || value}”.`);
  return amount * factor;
}

function parseViewBox(value: string | null): ViewBox | null {
  if (!value?.trim()) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) throw new Error('SVG viewBox must contain four finite numbers.');
  if (parts[2] <= 0 || parts[3] <= 0) throw new Error('SVG viewBox dimensions must be greater than zero.');
  return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
}

function viewBoxMatrix(viewBox: ViewBox, width: number, height: number, preserve: string | null, warn: (message: string) => void): AffineMatrix {
  const value = preserve?.trim() || 'xMidYMid meet';
  if (value === 'none') return [width / viewBox.width, 0, 0, height / viewBox.height, -viewBox.minX * width / viewBox.width, -viewBox.minY * height / viewBox.height];
  const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(value);
  if (!match) {
    warn(`Unsupported preserveAspectRatio “${value}”; default xMidYMid meet was used.`);
    return viewBoxMatrix(viewBox, width, height, null, () => {});
  }
  const scaleX = width / viewBox.width;
  const scaleY = height / viewBox.height;
  const scale = (match[3] ?? 'meet') === 'slice' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const drawnWidth = viewBox.width * scale;
  const drawnHeight = viewBox.height * scale;
  const alignX = match[1] === 'xMin' ? 0 : match[1] === 'xMid' ? (width - drawnWidth) / 2 : width - drawnWidth;
  const alignY = match[2] === 'YMin' ? 0 : match[2] === 'YMid' ? (height - drawnHeight) / 2 : height - drawnHeight;
  return [scale, 0, 0, scale, alignX - viewBox.minX * scale, alignY - viewBox.minY * scale];
}

function rootViewport(root: Element, warn: (message: string) => void): { width: number; height: number; matrix: AffineMatrix } {
  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const parseOptional = (name: string) => {
    const value = root.getAttribute(name);
    if (!value || value.trim().endsWith('%')) return null;
    return svgLength(value);
  };
  let width = parseOptional('width');
  let height = parseOptional('height');
  if (root.getAttribute('width')?.trim().endsWith('%') || root.getAttribute('height')?.trim().endsWith('%')) {
    warn('Percentage SVG root dimensions are unsupported; viewBox dimensions were used.');
  }
  if (viewBox) {
    if (width === null && height === null) { width = viewBox.width; height = viewBox.height; }
    else if (width === null && height !== null) width = height * viewBox.width / viewBox.height;
    else if (height === null && width !== null) height = width * viewBox.height / viewBox.width;
  }
  if (width === null || height === null) throw new Error('SVG requires a valid viewBox or finite width and height.');
  if (width <= 0 || height <= 0) throw new Error('SVG dimensions must be greater than zero.');
  return { width, height, matrix: viewBox ? viewBoxMatrix(viewBox, width, height, root.getAttribute('preserveAspectRatio'), warn) : IDENTITY_MATRIX };
}

function nestedViewport(element: Element, warn: (message: string) => void): AffineMatrix {
  const x = finiteNumber(element.getAttribute('x'), 0);
  const y = finiteNumber(element.getAttribute('y'), 0);
  const viewBox = parseViewBox(element.getAttribute('viewBox'));
  if (!viewBox) return [1, 0, 0, 1, x, y];
  const width = element.hasAttribute('width') ? svgLength(element.getAttribute('width')) : viewBox.width;
  const height = element.hasAttribute('height') ? svgLength(element.getAttribute('height')) : viewBox.height;
  if (width <= 0 || height <= 0) throw new Error('Nested SVG dimensions must be greater than zero.');
  return multiplyAffine([1, 0, 0, 1, x, y], viewBoxMatrix(viewBox, width, height, element.getAttribute('preserveAspectRatio'), warn));
}

function parsePoints(value: string | null): VectorPoint[] {
  if (!value?.trim()) throw new Error('SVG point list is empty.');
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts.length % 2 || parts.some((part) => !Number.isFinite(part))) throw new Error('SVG point list must contain finite X/Y pairs.');
  const points: VectorPoint[] = [];
  for (let index = 0; index < parts.length; index += 2) points.push(point(parts[index], parts[index + 1]));
  return points;
}

function lineSegments(points: VectorPoint[], close: boolean): VectorSegment[] {
  const segments: VectorSegment[] = [];
  for (let index = 1; index < points.length; index += 1) segments.push({ type: 'line', from: points[index - 1], to: points[index] });
  if (close && points.length > 2 && !samePoint(points[0], points[points.length - 1])) segments.push({ type: 'line', from: points[points.length - 1], to: points[0] });
  return segments;
}

function shapePaths(element: Element, id: string): VectorPath[] {
  const name = element.localName.toLowerCase();
  if (name === 'line') {
    const from = point(finiteNumber(element.getAttribute('x1'), 0), finiteNumber(element.getAttribute('y1'), 0));
    const to = point(finiteNumber(element.getAttribute('x2'), 0), finiteNumber(element.getAttribute('y2'), 0));
    return [{ id: `${id}-0`, closed: false, segments: [{ type: 'line', from, to }], transform: IDENTITY_MATRIX }];
  }
  if (name === 'polyline' || name === 'polygon') {
    const points = parsePoints(element.getAttribute('points'));
    const closed = name === 'polygon';
    return [{ id: `${id}-0`, closed, segments: lineSegments(points, closed), transform: IDENTITY_MATRIX }];
  }
  if (name === 'rect') {
    const x = finiteNumber(element.getAttribute('x'), 0); const y = finiteNumber(element.getAttribute('y'), 0);
    const width = finiteNumber(element.getAttribute('width')); const height = finiteNumber(element.getAttribute('height'));
    if (width <= 0 || height <= 0) throw new Error('SVG rectangle dimensions must be greater than zero.');
    let rx = element.hasAttribute('rx') ? finiteNumber(element.getAttribute('rx')) : element.hasAttribute('ry') ? finiteNumber(element.getAttribute('ry')) : 0;
    let ry = element.hasAttribute('ry') ? finiteNumber(element.getAttribute('ry')) : rx;
    if (rx < 0 || ry < 0) throw new Error('SVG rounded rectangle radii must not be negative.');
    rx = Math.min(rx, width / 2); ry = Math.min(ry, height / 2);
    if (!rx || !ry) {
      const points = [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
      return [{ id: `${id}-0`, closed: true, segments: lineSegments(points, true), transform: IDENTITY_MATRIX }];
    }
    const p0 = point(x + rx, y); const p1 = point(x + width - rx, y); const p2 = point(x + width, y + ry);
    const p3 = point(x + width, y + height - ry); const p4 = point(x + width - rx, y + height); const p5 = point(x + rx, y + height);
    const p6 = point(x, y + height - ry); const p7 = point(x, y + ry);
    const segments: VectorSegment[] = [
      { type: 'line', from: p0, to: p1 }, { type: 'arc', from: p1, to: p2, rx, ry, rotation: 0, largeArc: false, sweep: true },
      { type: 'line', from: p2, to: p3 }, { type: 'arc', from: p3, to: p4, rx, ry, rotation: 0, largeArc: false, sweep: true },
      { type: 'line', from: p4, to: p5 }, { type: 'arc', from: p5, to: p6, rx, ry, rotation: 0, largeArc: false, sweep: true },
      { type: 'line', from: p6, to: p7 }, { type: 'arc', from: p7, to: p0, rx, ry, rotation: 0, largeArc: false, sweep: true },
    ];
    return [{ id: `${id}-0`, closed: true, segments, transform: IDENTITY_MATRIX }];
  }
  if (name === 'circle' || name === 'ellipse') {
    const cx = finiteNumber(element.getAttribute('cx'), 0); const cy = finiteNumber(element.getAttribute('cy'), 0);
    const rx = name === 'circle' ? finiteNumber(element.getAttribute('r')) : finiteNumber(element.getAttribute('rx'));
    const ry = name === 'circle' ? rx : finiteNumber(element.getAttribute('ry'));
    if (rx <= 0 || ry <= 0) throw new Error(`SVG ${name} radii must be greater than zero.`);
    const points = [point(cx + rx, cy), point(cx, cy + ry), point(cx - rx, cy), point(cx, cy - ry), point(cx + rx, cy)];
    const segments: VectorSegment[] = [];
    for (let index = 1; index < points.length; index += 1) segments.push({ type: 'arc', from: points[index - 1], to: points[index], rx, ry, rotation: 0, largeArc: false, sweep: true });
    return [{ id: `${id}-0`, closed: true, segments, transform: IDENTITY_MATRIX }];
  }
  return [];
}

function closeForFill(path: VectorPath): VectorPath {
  if (path.closed || !path.segments.length) return path;
  const first = path.segments[0].from; const last = path.segments[path.segments.length - 1].to;
  return { ...path, closed: true, segments: samePoint(first, last) ? path.segments : [...path.segments, { type: 'line', from: last, to: first }] };
}

/** Parses untrusted SVG into inert numeric geometry. The returned DOM-free model is safe to clone to a worker. */
export function parseSvgText(source: string, limits: VectorParseLimits = DEFAULT_VECTOR_PARSE_LIMITS): VectorDocument {
  if (source.length > 5 * 1024 * 1024) throw new Error('Choose an SVG smaller than 5 MB.');
  if (typeof DOMParser === 'undefined') throw new Error('This browser does not provide secure XML parsing for SVG input.');
  if (/<!DOCTYPE/i.test(source)) throw new Error('SVG documents with DOCTYPE declarations are not supported.');
  const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('The SVG file contains malformed XML.');
  const root = xml.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') throw new Error('The selected file is not an SVG document.');

  const warningSet = new Set<string>();
  const warn = (message: string) => {
    if (warningSet.size < 100) warningSet.add(excerpt(message));
    else warningSet.add('Additional SVG warnings were omitted.');
  };
  for (const node of Array.from(xml.childNodes)) {
    if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE && node.nodeName.toLowerCase() === 'xml-stylesheet') warn('External SVG stylesheets are not supported and were ignored.');
  }
  const viewport = rootViewport(root, warn);
  const paths: VectorPath[] = [];
  const budget = { commands: 0, segments: 0, maxCommands: limits.maxPathCommands, maxSegments: limits.maxSegments };
  const initialPaint: PaintState = { stroke: 'none', fill: 'black', strokeWidth: 1, hidden: false };
  const stack: StackEntry[] = [{ element: root, matrix: viewport.matrix, paint: initialPaint, depth: 0, root: true }];
  let nodeCount = 0;
  let stableNodeIndex = 0;
  const geometry = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
  const containers = new Set(['svg', 'g', 'a']);

  while (stack.length) {
    const entry = stack.pop()!;
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) throw new Error('SVG XML node limit exceeded. Simplify the SVG and try again.');
    if (entry.depth > limits.maxDepth) throw new Error('SVG nesting depth limit exceeded. Simplify nested groups and try again.');
    const element = entry.element;
    const name = element.localName.toLowerCase();
    stableNodeIndex += 1;

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (attributeName.startsWith('on')) warn('SVG event-handler attributes are not supported and were ignored.');
      if ((attributeName === 'href' || attributeName.endsWith(':href')) && value) {
        warn(value.startsWith('#') ? 'SVG use/symbol references are not supported and were ignored.' : 'External or unsafe SVG references are not supported and were ignored.');
      }
      if (value.includes('javascript:') || value.includes('url(')) warn('Unsafe or referenced SVG URL values are not supported and were ignored.');
    }
    if (element.hasAttribute('style')) warn('SVG style attributes are not evaluated; presentation attributes or geometry defaults were used.');

    if (name === 'script') { warn('Unsupported SVG script element ignored.'); continue; }
    if (name === 'foreignobject') { warn('Unsupported SVG foreignObject element ignored.'); continue; }
    if (name === 'image') { warn('SVG image elements and external resources are not supported.'); continue; }
    if (name === 'text' || name === 'tspan') { warn('Unsupported SVG text element ignored. Convert text to paths before importing.'); continue; }
    if (name === 'style') { warn('SVG stylesheets are not evaluated and were ignored.'); continue; }
    if (name === 'use' || name === 'symbol') { warn('SVG use/symbol references are not supported and were ignored.'); continue; }
    if (['clippath', 'mask', 'filter', 'pattern', 'lineargradient', 'radialgradient'].includes(name)) { warn(`SVG ${name} effects are not supported and were ignored.`); continue; }
    if (name === 'defs' || name === 'metadata' || name === 'title' || name === 'desc') continue;
    if (!geometry.has(name) && !containers.has(name)) { warn(`Unsupported SVG <${name}> element ignored.`); continue; }

    let ownPaint: PaintState;
    try {
      ownPaint = {
        stroke: element.getAttribute('stroke') ?? entry.paint.stroke,
        fill: element.getAttribute('fill') ?? entry.paint.fill,
        strokeWidth: element.hasAttribute('stroke-width') ? svgLength(element.getAttribute('stroke-width')) : entry.paint.strokeWidth,
        hidden: entry.paint.hidden || element.getAttribute('display') === 'none' || element.getAttribute('visibility') === 'hidden',
      };
    } catch (error) {
      warn(error instanceof Error ? `${error.message} Affected SVG geometry was ignored.` : 'Malformed SVG presentation attributes ignored.');
      continue;
    }
    if (ownPaint.strokeWidth < 0) { warn('Negative SVG stroke width is invalid; affected geometry was ignored.'); continue; }
    if (ownPaint.hidden) continue;

    let matrix = entry.matrix;
    try {
      if (!entry.root && name === 'svg') matrix = multiplyAffine(matrix, nestedViewport(element, warn));
      matrix = multiplyAffine(matrix, parseSvgTransform(element.getAttribute('transform')));
    } catch (error) {
      warn(error instanceof Error ? `${error.message} Affected SVG geometry was ignored.` : 'Malformed SVG transform ignored.');
      continue;
    }

    if (geometry.has(name)) {
      try {
        let nextPaths = name === 'path'
          ? parsePathData(element.getAttribute('d') ?? '', `v${stableNodeIndex}`, budget)
          : shapePaths(element, `v${stableNodeIndex}`);
        if (name !== 'path') {
          let added = 0;
          for (const path of nextPaths) added += path.segments.length;
          budget.commands += added; budget.segments += added;
          if (budget.commands > limits.maxPathCommands) throw new Error('SVG path command limit exceeded. Simplify the SVG and try again.');
          if (budget.segments > limits.maxSegments) throw new Error('SVG vector segment limit exceeded. Simplify the SVG and try again.');
        }
        const strokeValue = ownPaint.stroke.trim().toLowerCase();
        const fillValue = ownPaint.fill.trim().toLowerCase();
        const hasStroke = strokeValue !== '' && strokeValue !== 'none' && ownPaint.strokeWidth > 0 && !strokeValue.includes('url(');
        const hasFill = fillValue !== '' && fillValue !== 'none' && !fillValue.includes('url(');
        if (!hasStroke && !hasFill) continue;
        if (!hasStroke && hasFill && (name === 'line' || name === 'polyline')) {
          warn('Unstroked open SVG line geometry was ignored because fills do not render on open lines.');
          continue;
        }
        if (!hasStroke && hasFill) {
          warn('Fill-only SVG geometry was imported as an outline; fill hatching is not supported.');
          const beforeClosure = nextPaths.reduce((total, path) => total + path.segments.length, 0);
          nextPaths = nextPaths.map(closeForFill);
          const addedClosure = nextPaths.reduce((total, path) => total + path.segments.length, 0) - beforeClosure;
          budget.commands += addedClosure; budget.segments += addedClosure;
          if (budget.commands > limits.maxPathCommands || budget.segments > limits.maxSegments) throw new Error('SVG vector segment limit exceeded. Simplify the SVG and try again.');
        } else if (hasStroke && hasFill) {
          warn('SVG fills are not hatched; stroked geometry was imported as centerlines.');
        }
        for (const path of nextPaths) paths.push({ ...path, transform: matrix, ...(hasStroke ? { strokeWidth: ownPaint.strokeWidth } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Malformed SVG geometry was ignored.';
        if (/limit exceeded/i.test(message)) throw error;
        warn(`${message} Affected SVG geometry was ignored.`);
      }
    }

    if (containers.has(name)) {
      const children = Array.from(element.children);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ element: children[index], matrix, paint: ownPaint, depth: entry.depth + 1, root: false });
    }
  }
  if (!paths.length) throw new Error('The SVG contains no supported visible vector geometry.');
  let segmentCount = 0;
  for (const path of paths) segmentCount += path.segments.length;
  return { width: viewport.width, height: viewport.height, paths, warnings: [...warningSet], nodeCount, segmentCount };
}
