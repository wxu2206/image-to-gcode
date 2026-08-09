export type Viewport = { zoom: number; pan: { x: number; y: number } };
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export const MIN_ZOOM = .1;
export const MAX_ZOOM = 20;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));

const baseScale = (canvasWidth: number, canvasHeight: number, workWidth: number, workHeight: number) => Math.min((canvasWidth - 40) / workWidth, (canvasHeight - 40) / workHeight);

/** Zooms around a canvas point while leaving the world point below that cursor fixed. */
export function zoomAtCursor(viewport: Viewport, cursor: { x: number; y: number }, factor: number, canvas: { width: number; height: number }, work: { width: number; height: number }): Viewport {
  const base = baseScale(canvas.width, canvas.height, work.width, work.height);
  const oldScale = base * viewport.zoom;
  const nextZoom = clampZoom(viewport.zoom * factor);
  const nextScale = base * nextZoom;
  const oldOriginX = (canvas.width - work.width * oldScale) / 2 + viewport.pan.x;
  const oldOriginY = (canvas.height - work.height * oldScale) / 2 + viewport.pan.y;
  const worldX = (cursor.x - oldOriginX) / oldScale;
  const worldY = (cursor.y - oldOriginY) / oldScale;
  const nextOriginX = (canvas.width - work.width * nextScale) / 2;
  const nextOriginY = (canvas.height - work.height * nextScale) / 2;
  return { zoom: nextZoom, pan: { x: cursor.x - nextOriginX - worldX * nextScale, y: cursor.y - nextOriginY - worldY * nextScale } };
}

/** Fits machine-coordinate geometry into the canvas with a restrained margin. */
export function fitViewport(bounds: Bounds | null, canvas: { width: number; height: number }, work: { width: number; height: number }): Viewport {
  if (!bounds || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return { zoom: 1, pan: { x: 0, y: 0 } };
  const margin = 56;
  const base = baseScale(canvas.width, canvas.height, work.width, work.height);
  const scale = Math.min((canvas.width - margin) / (bounds.maxX - bounds.minX), (canvas.height - margin) / (bounds.maxY - bounds.minY));
  const zoom = clampZoom(scale / base);
  const actualScale = base * zoom;
  const originX = (canvas.width - work.width * actualScale) / 2;
  const originY = (canvas.height - work.height * actualScale) / 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return { zoom, pan: { x: canvas.width / 2 - originX - centerX * actualScale, y: canvas.height / 2 - originY - (work.height - centerY) * actualScale } };
}
