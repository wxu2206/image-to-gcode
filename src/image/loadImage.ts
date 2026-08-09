const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const mime = file.type.toLowerCase();
  if (mime) return SUPPORTED_MIME_TYPES.has(mime);
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension !== undefined && SUPPORTED_EXTENSIONS.has(extension);
}

export function validateImageFile(file: File): void {
  if (!isSupportedImageFile(file)) throw new Error('Choose one PNG, JPEG, or WebP image.');
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
