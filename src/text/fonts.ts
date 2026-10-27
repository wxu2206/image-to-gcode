import type { Point, Path } from '../core/types';

type RawGlyph = { advance: number; strokes: number[][] };
export type StrokeFont = {
  id: string;
  name: string;
  category: 'single-line';
  description: string;
  widthScale: number;
  slant: number;
};

// Original project font data. Each pair is a pen coordinate on a 10 x 14 em;
// separate arrays are disconnected strokes. Licensed under the repository MIT
// license; see public/fonts/LICENSE.txt. This is vector stroke data, not traced
// raster artwork and not an outline font pretending to be a single-line face.
const raw: Record<string, string> = {
  A:'0,0 5,14 10,0|2,5 8,5', B:'0,0 0,14 6,14 9,12 9,9 6,7 0,7|6,7 10,5 10,2 7,0 0,0', C:'10,12 8,14 2,14 0,12 0,2 2,0 8,0 10,2',
  D:'0,0 0,14 5,14 10,10 10,4 5,0 0,0', E:'10,14 0,14 0,0 10,0|0,7 8,7', F:'0,0 0,14 10,14|0,7 8,7', G:'10,11 8,14 2,14 0,11 0,3 2,0 8,0 10,2 10,6 6,6',
  H:'0,0 0,14|10,0 10,14|0,7 10,7', I:'0,14 10,14|5,14 5,0|0,0 10,0', J:'0,3 2,0 7,0 9,2 9,14|4,14 10,14', K:'0,0 0,14|10,14 0,5|4,9 10,0',
  L:'0,14 0,0 10,0', M:'0,0 0,14 5,7 10,14 10,0', N:'0,0 0,14 10,0 10,14', O:'2,0 0,2 0,12 2,14 8,14 10,12 10,2 8,0 2,0',
  P:'0,0 0,14 7,14 10,11 10,8 7,6 0,6', Q:'2,0 0,2 0,12 2,14 8,14 10,12 10,2 8,0 2,0|6,4 11,-1', R:'0,0 0,14 7,14 10,11 10,8 7,6 0,6|6,6 10,0',
  S:'10,12 8,14 2,14 0,12 0,9 2,7 8,7 10,5 10,2 8,0 2,0 0,2', T:'0,14 10,14|5,14 5,0', U:'0,14 0,3 3,0 7,0 10,3 10,14', V:'0,14 5,0 10,14',
  W:'0,14 2,0 5,7 8,0 10,14', X:'0,14 10,0|10,14 0,0', Y:'0,14 5,7 10,14|5,7 5,0', Z:'0,14 10,14 0,0 10,0',
  '0':'2,0 0,2 0,12 2,14 8,14 10,12 10,2 8,0 2,0|2,2 8,12', '1':'2,11 5,14 5,0|2,0 8,0', '2':'0,11 2,14 8,14 10,11 10,9 0,0 10,0',
  '3':'0,12 2,14 8,14 10,12 10,9 7,7 10,5 10,2 8,0 2,0 0,2|3,7 7,7', '4':'8,0 8,14 0,4 10,4', '5':'10,14 1,14 0,7 7,7 10,5 10,2 8,0 2,0 0,2',
  '6':'9,13 7,14 3,14 0,10 0,3 3,0 7,0 10,3 10,6 7,8 0,7', '7':'0,14 10,14 3,0', '8':'2,7 0,9 0,12 2,14 8,14 10,12 10,9 8,7 2,7 0,5 0,2 2,0 8,0 10,2 10,5 8,7',
  '9':'10,7 3,6 0,8 0,11 3,14 7,14 10,11 10,4 7,0 3,0 1,1',
  '.':'5,0 5,1', ',':'5,1 4,-2', ':':'5,10 5,11|5,1 5,2', ';':'5,10 5,11|5,2 4,-1', '!':'5,14 5,4|5,0 5,1', '?':'0,11 2,14 8,14 10,12 10,9 5,6 5,3|5,0 5,1',
  '-':'1,7 9,7', '_':'0,0 10,0', '+':'1,7 9,7|5,11 5,3', '=':'1,9 9,9|1,5 9,5', '/':'0,0 10,14', '\\':'0,14 10,0', '(':'7,14 4,11 3,7 4,3 7,0', ')':'3,14 6,11 7,7 6,3 3,0',
  '[':'7,14 3,14 3,0 7,0', ']':'3,14 7,14 7,0 3,0', '{':'8,14 5,13 4,9 2,7 4,5 5,1 8,0', '}':'2,14 5,13 6,9 8,7 6,5 5,1 2,0', '<':'9,13 1,7 9,1', '>':'1,13 9,7 1,1',
  "'":'5,14 4,10', '"':'3,14 3,10|7,14 7,10', '`':'4,14 6,12', '~':'0,6 3,9 7,5 10,8', '|':'5,14 5,0', '@':'8,4 8,10 6,12 3,12 1,9 1,4 3,2 8,2 10,5 10,11 8,14 3,14 0,11 0,3 3,0 9,0',
  '#':'3,14 2,0|8,14 7,0|0,10 10,10|0,4 10,4', '$':'9,12 7,14 3,14 1,12 1,9 3,7 7,7 9,5 9,2 7,0 3,0 1,2|5,16 5,-2', '%':'0,0 10,14|2,14 0,12 2,10 4,12 2,14|8,4 6,2 8,0 10,2 8,4',
  '^':'1,9 5,14 9,9', '&':'10,0 2,10 2,12 4,14 7,13 8,11 2,4 2,2 4,0 7,0 10,4', '*':'5,12 5,4|1,10 9,6|9,10 1,6',
};

const parseGlyph = (source: string): RawGlyph => ({
  advance: 11,
  strokes: source.split('|').map((stroke) => stroke.split(' ').flatMap((pair) => pair.split(',').map(Number))),
});
const glyphs = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, parseGlyph(value)]));

export const strokeFonts: StrokeFont[] = [
  { id: 'plotter-simplex', name: 'Plotter Simplex', category: 'single-line', description: 'Balanced single-line drafting hand', widthScale: 0.68, slant: 0 },
  { id: 'plotter-script', name: 'Plotter Script', category: 'single-line', description: 'Narrow, slanted single-line writing', widthScale: 0.57, slant: 0.24 },
  { id: 'plotter-technical', name: 'Plotter Technical', category: 'single-line', description: 'Wide single-line technical lettering', widthScale: 0.84, slant: 0 },
];

export const getStrokeFont = (id: string) => strokeFonts.find((font) => font.id === id) ?? strokeFonts[0];
export const supportedCharacter = (character: string) => character === ' ' || Boolean(glyphs[character] ?? glyphs[character.toUpperCase()]);

function glyphFor(character: string): { glyph: RawGlyph; lowercase: boolean } | null {
  const direct = glyphs[character];
  if (direct) return { glyph: direct, lowercase: false };
  const upper = character.toUpperCase();
  if (character !== upper && glyphs[upper]) return { glyph: glyphs[upper], lowercase: true };
  return null;
}

export function characterAdvance(character: string, fontId: string, fontSizeMm: number, letterSpacingMm: number): number {
  if (character === ' ') return fontSizeMm * 0.42 + letterSpacingMm;
  const found = glyphFor(character);
  const base = found?.glyph.advance ?? 8;
  const font = getStrokeFont(fontId);
  return (base / 14 * font.widthScale + Math.max(0, font.slant)) * fontSizeMm + letterSpacingMm;
}

export function glyphPaths(character: string, fontId: string, fontSizeMm: number, x: number, baselineY: number, idPrefix: string): Path[] {
  const found = glyphFor(character);
  if (!found) return [];
  const font = getStrokeFont(fontId);
  const lowerScale = found.lowercase ? 0.78 : 1;
  const yOffset = found.lowercase ? 0 : 0;
  return found.glyph.strokes.map((stroke, strokeIndex) => {
    const points: Point[] = [];
    for (let index = 0; index < stroke.length; index += 2) {
      const rawX = stroke[index]; const rawY = stroke[index + 1];
      const normalizedY = rawY / 14 * lowerScale + yOffset;
      points.push({
        x: x + (rawX / 14 * font.widthScale + normalizedY * font.slant) * fontSizeMm,
        y: baselineY - normalizedY * fontSizeMm,
      });
    }
    return { id: `${idPrefix}-s${strokeIndex}`, kind: 'work' as const, points };
  }).filter((path) => path.points.length > 1);
}

export function fontSamplePolylines(fontId: string, text = 'Abc 123'): Point[][] {
  let x = 0; const result: Point[][] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    result.push(...glyphPaths(character, fontId, 14, x, 15, `sample-${index}`).map((path) => path.points));
    x += characterAdvance(character, fontId, 14, 1);
  }
  return result;
}
