import { SVG_LIMITS } from '../vector/model';

export type SupportedInputKind = 'raster' | 'svg';

const RASTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SVG_MIME_TYPES = new Set(['image/svg+xml', 'application/svg+xml']);
const MAX_IMAGE_FILE_BYTES = 40 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 48_000_000;

export function inputFileKind(file: Pick<File, 'name' | 'type'>): SupportedInputKind | null {
  const mime = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  const genericMime = mime === '' || mime === 'application/octet-stream';
  if (extension === 'svg') return genericMime || SVG_MIME_TYPES.has(mime) ? 'svg' : null;
  if (extension && RASTER_EXTENSIONS.has(extension)) return genericMime || RASTER_MIME_TYPES.has(mime) ? 'raster' : null;
  // A real filename with an unknown extension is not accepted solely because an
  // untrusted MIME label claims that it is an image.
  if (extension && file.name.includes('.')) return null;
  if (SVG_MIME_TYPES.has(mime)) return 'svg';
  if (RASTER_MIME_TYPES.has(mime)) return 'raster';
  return null;
}

export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return inputFileKind(file) !== null;
}

export function validateImageFile(file: File): void {
  const kind = inputFileKind(file);
  if (!kind) throw new Error('Choose one PNG, JPEG, WebP, or SVG file.');
  if (kind === 'svg' && file.size > SVG_LIMITS.maxFileBytes) throw new Error('Choose an SVG smaller than 5 MB.');
  if (kind === 'raster' && file.size > MAX_IMAGE_FILE_BYTES) throw new Error('Choose an image smaller than 40 MB.');
}

export async function readSvgFile(file: File): Promise<string> {
  validateImageFile(file);
  if (inputFileKind(file) !== 'svg') throw new Error('The selected file is not an SVG.');
  try {
    return await file.text();
  } catch {
    throw new Error(`Could not read “${file.name}”. Try another SVG.`);
  }
}

export function decodeImageFile(file: File): Promise<HTMLImageElement> {
  validateImageFile(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read “${file.name}”. Try another image.`));
    reader.onabort = () => reject(new Error('Image loading was cancelled.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read “${file.name}”. Try another image.`));
        return;
      }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`“${file.name}” is not a valid or supported image.`));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function readImagePixels(image: HTMLImageElement, maximumDimension = 900): ImageData {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('The image has invalid pixel dimensions.');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_SOURCE_PIXELS / height) {
    throw new Error('This image has too many pixels to process safely. Resize it below 48 megapixels and try again.');
  }
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not initialize image processing.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error('This browser could not read the decoded image pixels.');
  }
}
