export function formatEstimatedDuration(minutes: number): string {
  const seconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
  if (seconds < 60) return `~${seconds} sec`;
  const wholeMinutes = Math.round(seconds / 60);
  if (wholeMinutes < 60) return `~${wholeMinutes} min`;
  const hours = Math.floor(wholeMinutes / 60);
  const remainder = wholeMinutes % 60;
  return remainder ? `~${hours} h ${remainder} min` : `~${hours} h`;
}

export function formatPlaybackClock(minutes: number): string {
  const seconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
  const hours = Math.floor(seconds / 3_600);
  const mins = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${two(mins)}:${two(secs)}` : `${mins}:${two(secs)}`;
}
