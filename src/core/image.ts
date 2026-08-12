export type PixelData = { width: number; height: number; data: Uint8ClampedArray };
export type GrayImage = PixelData;
export type ImageProgress = (completed: number, total: number) => void;
export type CleanupResult = { image: GrayImage; removedComponents: number; removedPixels: number };

const reportEvery = 16_384;

function assertPixelData(input: PixelData): void {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error('Image dimensions must be positive integers.');
  }
  const pixels = input.width * input.height;
  if (!Number.isSafeInteger(pixels) || input.data.length !== pixels * 4) {
    throw new Error('Image pixel data does not match its dimensions.');
  }
}

/** Converts decoded RGBA pixels without allocating intermediary colour images. */
export function processImage(
  input: PixelData,
  opt: { brightness: number; contrast: number; invert: boolean; filter: string; threshold: number },
  onProgress?: ImageProgress,
): GrayImage {
  assertPixelData(input);
  if (!Number.isFinite(opt.brightness) || !Number.isFinite(opt.contrast) || !Number.isFinite(opt.threshold)) {
    throw new Error('Image processing settings must be finite.');
  }
  if (!['grayscale', 'threshold', 'edge', 'dither'].includes(opt.filter)) throw new Error('Unknown image processing filter.');
  const pixels = input.width * input.height;
  const data = new Uint8ClampedArray(pixels);
  const totalWork = opt.filter === 'grayscale' ? pixels : pixels * 2;
  const report = (completed: number) => onProgress?.(completed, totalWork);

  for (let index = 0; index < pixels; index += 1) {
    const source = index * 4;
    const alpha = input.data[source + 3] / 255;
    // Canvas exposes transparent pixels as RGBA. Composite against white so
    // transparent PNG regions do not become unintended black toolpaths.
    let value = (0.2126 * input.data[source] + 0.7152 * input.data[source + 1] + 0.0722 * input.data[source + 2]) * alpha + 255 * (1 - alpha);
    value = (value - 128) * (1 + opt.contrast / 100) + 128 + opt.brightness;
    if (opt.invert) value = 255 - value;
    if (alpha === 0) value = 255;
    data[index] = Math.max(0, Math.min(255, value));
    if (index % reportEvery === 0) report(index);
  }

  if (opt.filter === 'edge') {
    const output = new Uint8ClampedArray(pixels);
    output.fill(255);
    for (let y = 1; y < input.height - 1; y += 1) {
      for (let x = 1; x < input.width - 1; x += 1) {
        const index = y * input.width + x;
        if (input.data[index * 4 + 3] === 0) continue;
        const magnitude = Math.min(255, Math.abs(data[index - 1] - data[index + 1]) + Math.abs(data[index - input.width] - data[index + input.width]));
        output[index] = 255 - magnitude;
      }
      if (y % 16 === 0) report(pixels + y * input.width);
    }
    report(totalWork);
    return { width: input.width, height: input.height, data: output };
  }
  if (opt.filter === 'threshold') {
    for (let index = 0; index < pixels; index += 1) {
      data[index] = data[index] < opt.threshold ? 0 : 255;
      if (index % reportEvery === 0) report(pixels + index);
    }
  }
  if (opt.filter === 'dither') {
    const diffuse = (target: number, amount: number) => {
      if (input.data[target * 4 + 3] !== 0) data[target] += amount;
    };
    for (let y = 0; y < input.height; y += 1) {
      for (let x = 0; x < input.width; x += 1) {
        const index = y * input.width + x;
        if (input.data[index * 4 + 3] === 0) {
          data[index] = 255;
          continue;
        }
        const old = data[index];
        const next = old < 128 ? 0 : 255;
        const error = old - next;
        data[index] = next;
        if (x + 1 < input.width) diffuse(index + 1, error * 7 / 16);
        if (x + 1 < input.width && y + 1 < input.height) diffuse(index + input.width + 1, error / 16);
        if (y + 1 < input.height) diffuse(index + input.width, error * 5 / 16);
        if (x && y + 1 < input.height) diffuse(index + input.width - 1, error * 3 / 16);
      }
      if (y % 16 === 0) report(pixels + y * input.width);
    }
  }
  report(totalWork);
  return { width: input.width, height: input.height, data };
}

/**
 * Removes only disconnected dark components whose physical bounding box and area
 * fall below the selected detail-derived threshold. Dithering is intentionally
 * excluded because isolated dots carry its tonal information.
 */
export function cleanupTinyArtifacts(image: GrayImage, settings: { outputWidth: number; outputHeight: number; units: 'mm' | 'in'; toolpathDetail: number; threshold: number; filter: string; noiseCleanup: 'off' | 'light' | 'normal' | 'strong' }): CleanupResult {
  if (settings.noiseCleanup === 'off' || settings.filter === 'dither') return { image, removedComponents: 0, removedPixels: 0 };
  if (!Number.isFinite(settings.outputWidth) || !Number.isFinite(settings.outputHeight) || !Number.isFinite(settings.toolpathDetail) || !Number.isFinite(settings.threshold)) throw new Error('Noise cleanup settings must be finite.');
  const factor = settings.noiseCleanup === 'light' ? .75 : settings.noiseCleanup === 'normal' ? 1.5 : 2.5;
  const mmScale = settings.units === 'in' ? 25.4 : 1;
  // Toolpath Detail is deliberately stored in millimetres even when the output
  // G-code uses inches (see convertSettingsUnits).
  const maxSize = Math.max(.01, settings.toolpathDetail * factor);
  const mmX = settings.outputWidth * mmScale / image.width;
  const mmY = settings.outputHeight * mmScale / image.height;
  const visited = new Uint8Array(image.data.length);
  const output = image.data.slice();
  const queue = new Int32Array(image.data.length);
  let removedComponents = 0;
  let removedPixels = 0;
  for (let start = 0; start < image.data.length; start += 1) {
    if (visited[start] || image.data[start] >= settings.threshold) continue;
    let head = 0; let tail = 0;
    queue[tail++] = start; visited[start] = 1;
    let minX = start % image.width; let maxX = minX; let minY = Math.floor(start / image.width); let maxY = minY;
    while (head < tail) {
      const index = queue[head++]; const x = index % image.width; const y = Math.floor(index / image.width);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0) continue;
        const nextX = x + xOffset; const nextY = y + yOffset;
        if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
        const next = nextY * image.width + nextX;
        if (!visited[next] && image.data[next] < settings.threshold) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    const componentWidth = (maxX - minX + 1) * mmX;
    const componentHeight = (maxY - minY + 1) * mmY;
    if (Math.max(componentWidth, componentHeight) <= maxSize && componentWidth * componentHeight <= maxSize * maxSize) {
      for (let index = 0; index < tail; index += 1) output[queue[index]] = 255;
      removedComponents += 1; removedPixels += tail;
    }
  }
  return removedComponents ? { image: { ...image, data: output }, removedComponents, removedPixels } : { image, removedComponents, removedPixels };
}
