import type { GrayImage } from './image';
import type { Settings } from './types';
import { toMillimetres } from './units';

export type DetailResolution = { width: number; height: number; physicalWidthMm: number; physicalHeightMm: number };
export type DetailProgress = (completed: number, total: number) => void;

/**
 * Finds the useful sampling grid from physical output dimensions. The source image
 * remains the upper bound, so detail can never manufacture pixels that do not exist.
 */
export function detailResolution(source: Pick<GrayImage, 'width' | 'height'>, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'toolpathDetail' | 'units'>): DetailResolution {
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width <= 0 || source.height <= 0) {
    throw new Error('Source image dimensions must be positive integers.');
  }
  if (!Number.isFinite(settings.outputWidth) || !Number.isFinite(settings.outputHeight) || settings.outputWidth <= 0 || settings.outputHeight <= 0 || !Number.isFinite(settings.toolpathDetail) || settings.toolpathDetail <= 0) {
    throw new Error('Physical detail settings must be finite and greater than zero.');
  }
  const physicalWidthMm = toMillimetres(settings.outputWidth, settings.units);
  const physicalHeightMm = toMillimetres(settings.outputHeight, settings.units);
  const detail = Math.max(0.05, settings.toolpathDetail);
  return {
    width: Math.max(1, Math.min(source.width, Math.ceil(physicalWidthMm / detail))),
    height: Math.max(1, Math.min(source.height, Math.ceil(physicalHeightMm / detail))),
    physicalWidthMm,
    physicalHeightMm,
  };
}

/** Bilinear grayscale resampling. Geometry is later scaled back to the exact requested output size. */
export function resampleForToolpath(image: GrayImage, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'toolpathDetail' | 'units'>, onProgress?: DetailProgress): GrayImage {
  if (image.data.length !== image.width * image.height) throw new Error('Processed image data does not match its dimensions.');
  const target = detailResolution(image, settings);
  if (target.width === image.width && target.height === image.height) {
    onProgress?.(1, 1);
    return image;
  }
  const data = new Uint8ClampedArray(target.width * target.height);
  const scaleX = image.width / target.width;
  const scaleY = image.height / target.height;
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(image.height - 1, (y + 0.5) * scaleY - 0.5);
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(image.width - 1, (x + 0.5) * scaleX - 0.5);
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const top = image.data[y0 * image.width + x0] * (1 - fx) + image.data[y0 * image.width + x1] * fx;
      const bottom = image.data[y1 * image.width + x0] * (1 - fx) + image.data[y1 * image.width + x1] * fx;
      data[y * target.width + x] = top * (1 - fy) + bottom * fy;
    }
    if (y % 8 === 0) onProgress?.(y, target.height);
  }
  onProgress?.(target.height, target.height);
  return { width: target.width, height: target.height, data };
}

export function detailInOutputUnits(settings: Pick<Settings, 'toolpathDetail' | 'units'>): number {
  return settings.units === 'in' ? settings.toolpathDetail / 25.4 : settings.toolpathDetail;
}
