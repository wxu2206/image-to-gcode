/** Return a bounded window beginning at the first case-insensitive match. */
export function visibleGcodeLines(code: string, search: string) {
  const match = search ? code.toLowerCase().indexOf(search.toLowerCase()) : 0;
  if (match < 0) return { lines: [] as string[], start: 1, summary: 'No matching G-code lines' };
  const startOffset = search ? code.lastIndexOf('\n', match) + 1 : 0;
  let start = 1;
  for (let index = 0; index < startOffset; index += 1) if (code.charCodeAt(index) === 10) start += 1;
  const lines = code.slice(startOffset).split('\n', search ? 200 : 2_000);
  if (lines[lines.length - 1] === '') lines.pop();
  const summary = search
    ? `Showing ${lines.length.toLocaleString()} lines from the match (starting at line ${start.toLocaleString()})`
    : `Showing ${lines.length.toLocaleString()} lines from the start`;
  return { lines, start, summary };
}
