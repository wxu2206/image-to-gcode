const unsafeFilename = /[\\/:*?"<>|]+/g;
const bidiControls = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const withoutControls = (value: string) => Array.from(value).filter((character) => {
  const code = character.charCodeAt(0);
  return code >= 32 && code !== 127;
}).join('');

/** Produces a readable browser-download filename, never a path-like one. */
export function gcodeFilename(sourceName: string, mode: string): string {
  const pageSuffix = sourceName.match(/(-page-\d+)$/i)?.[1] ?? '';
  const sourceWithoutPage = pageSuffix ? sourceName.slice(0, -pageSuffix.length) : sourceName;
  const base = withoutControls(`${sourceWithoutPage.replace(/\.[^.]*$/, '')}${pageSuffix}`).replace(bidiControls, '').replace(unsafeFilename, '-').replace(/\s+/g, ' ').replace(/^[.-]+|[.-]+$/g, '').trim();
  const safeBase = pageSuffix
    ? `${(base.slice(0, -pageSuffix.length) || 'document').slice(0, Math.max(0, 96 - pageSuffix.length))}${pageSuffix.slice(-96)}`
    : (base || 'image').slice(0, 96);
  const safeMode = mode.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'toolpath';
  return `${safeBase}-${safeMode}.gcode`;
}
