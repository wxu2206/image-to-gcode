import { arcToCenter } from './flatten';
import type { VectorDocument, VectorPoint } from './model';

const samePoint = (a: VectorPoint, b: VectorPoint) => a.x === b.x && a.y === b.y;

/** Builds inert Canvas geometry only; imported SVG markup is never inserted into the DOM. */
export function buildVectorPreviewPath(document: VectorDocument): Path2D {
  const combined = new Path2D();
  for (const path of document.paths) {
    if (!path.segments.length) continue;
    const local = new Path2D();
    let cursor = path.segments[0].from;
    local.moveTo(cursor.x, cursor.y);
    for (const segment of path.segments) {
      if (!samePoint(cursor, segment.from)) local.moveTo(segment.from.x, segment.from.y);
      if (segment.type === 'line') local.lineTo(segment.to.x, segment.to.y);
      else if (segment.type === 'quadratic') local.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
      else if (segment.type === 'cubic') local.bezierCurveTo(segment.control1.x, segment.control1.y, segment.control2.x, segment.control2.y, segment.to.x, segment.to.y);
      else {
        const arc = arcToCenter(segment);
        if (arc) local.ellipse(arc.cx, arc.cy, arc.rx, arc.ry, arc.rotation, arc.startAngle, arc.startAngle + arc.deltaAngle, arc.deltaAngle < 0);
        else local.lineTo(segment.to.x, segment.to.y);
      }
      cursor = segment.to;
    }
    if (path.closed) local.closePath();
    combined.addPath(local, new DOMMatrix([...path.transform]));
  }
  return combined;
}
