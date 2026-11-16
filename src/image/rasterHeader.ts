const MAX_SOURCE_PIXELS = 48_000_000;
const MAX_HEADER_CHUNKS = 10_000;
const invalidImage = () => new Error('This file is not a valid or supported PNG, JPEG, or WebP image.');

function checkDimensions(width: number, height: number): void {
  if (!width || !height) throw invalidImage();
  if (width > MAX_SOURCE_PIXELS / height) {
    throw new Error('This image has too many pixels to process safely. Resize it below 48 megapixels and try again.');
  }
}

/** Inspect bounded compressed bytes before handing them to the browser's bitmap decoder. */
export function validateRasterHeader(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, value: string) => offset + value.length <= bytes.length
    && Array.from(value).every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  const le24 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;

  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 'PNG\r\n\x1a\n')) {
    if (view.getUint32(8) !== 13 || !text(12, 'IHDR')) throw invalidImage();
    checkDimensions(view.getUint32(16), view.getUint32(20));
    return;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    for (let count = 0; count < MAX_HEADER_CHUNKS && offset < bytes.length; count += 1) {
      if (bytes[offset] !== 0xff) throw invalidImage();
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) throw invalidImage();
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || marker === 0x00) throw invalidImage();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw invalidImage();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalidImage();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw invalidImage();
        checkDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return;
      }
      offset += length;
    }
    throw invalidImage();
  }

  if (bytes.length >= 20 && text(0, 'RIFF') && text(8, 'WEBP')) {
    const end = view.getUint32(4, true) + 8;
    if (end !== bytes.length) throw invalidImage();
    let foundDimensions = false;
    let chunks = 0;
    const scan = (start: number, limit: number, frame = false): void => {
      let offset = start;
      while (offset < limit) {
        if (++chunks > MAX_HEADER_CHUNKS || offset + 8 > limit) throw invalidImage();
        const length = view.getUint32(offset + 4, true);
        const data = offset + 8;
        const next = data + length + (length & 1);
        if (next > limit) throw invalidImage();
        if (text(offset, 'VP8X')) {
          if (frame || length < 10) throw invalidImage();
          checkDimensions(le24(data + 4) + 1, le24(data + 7) + 1);
          foundDimensions = true;
        } else if (text(offset, 'VP8 ')) {
          if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) throw invalidImage();
          checkDimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
          foundDimensions = true;
        } else if (text(offset, 'VP8L')) {
          if (length < 5 || bytes[data] !== 0x2f) throw invalidImage();
          checkDimensions(1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8),
            1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10));
          foundDimensions = true;
        } else if (text(offset, 'ANMF')) {
          if (frame || length < 16) throw invalidImage();
          checkDimensions(le24(data + 6) + 1, le24(data + 9) + 1);
          scan(data + 16, data + length, true);
        }
        offset = next;
      }
    };
    scan(12, end);
    if (!foundDimensions) throw invalidImage();
    return;
  }
  throw invalidImage();
}
