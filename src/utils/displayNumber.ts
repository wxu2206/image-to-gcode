/** Presentation only: suppress floating-point tails without quantizing geometry. */
export function displayNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value);
}
