import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { JobWarnings } from './JobWarnings';

it('announces one compact summary and exposes warning details on demand', () => {
  render(<JobWarnings warnings={['48 paths outside work area (48 start outside; 48 extend outside).', 'Transformed image exceeds the configured work area.']} />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('2 job warnings');
  expect(screen.getByRole('status').textContent).toContain('48 paths outside work area');
  const summary = screen.getByText('Warning details');
  expect(summary.closest('details')!.open).toBe(false);
  fireEvent.click(summary);
  expect(summary.closest('details')!.open).toBe(true);
  expect(screen.getByText('48 paths outside work area (48 start outside; 48 extend outside).')).toBeTruthy();
});
