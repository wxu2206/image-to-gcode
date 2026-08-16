export function formatMachineNumber(value: number, precision: number): string {
  if (!Number.isFinite(value)) throw new Error('G-code serialization received a non-finite number.');
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new Error('G-code precision must be an integer from 0 to 8.');
  const fixed = value.toFixed(precision);
  if (Number(fixed) === 0) return '0';
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

export function quantizeMachineNumber(value: number, precision: number): number {
  if (!Number.isFinite(value)) throw new Error('Machine geometry contains a non-finite coordinate.');
  const factor = 10 ** precision;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}
