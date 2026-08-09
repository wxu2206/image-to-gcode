const unsafeFilename = /[\\/:*?"<>|]+/g;
const withoutControls = (value: string) => Array.from(value).filter((character) => {
  const code = character.charCodeAt(0);
  return code >= 32 && code !== 127;
}).join('');

/** Produces a readable browser-download filename, never a path-like one. */
export function gcodeFilename(sourceName: string, mode: string): string {
  const base = withoutControls(sourceName.replace(/\.[^.]*$/, '')).replace(unsafeFilename, '-').replace(/\s+/g, ' ').replace(/^[.-]+|[.-]+$/g, '').trim();
  const safeBase = (base || 'image').slice(0, 96);
  const safeMode = mode.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'toolpath';
  return `${safeBase}-${safeMode}.gcode`;
}
