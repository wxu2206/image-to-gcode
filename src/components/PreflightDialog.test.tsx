import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PreflightResult } from '../core/exportReview';
import { defaults, profiles } from '../core/machine';
import { PreflightDialog } from './PreflightDialog';

const result = (status: PreflightResult['status']): PreflightResult => ({
  status,
  warningCount: status === 'warnings' ? 1 : 0,
  blockingCount: status === 'blocked' ? 1 : 0,
  checks: [{
    id: 'fixture',
    severity: status === 'passed' ? 'pass' : status === 'warnings' ? 'warning' : 'blocking',
    title: 'Fixture check',
    message: '<img src=x onerror=alert(1)> rendered as text',
  }],
  summary: {
    start: { x: 0, y: 0, z: 5 }, end: { x: 10, y: 4, z: 5 },
    movementCount: 12, pathCount: 2, drawingDistance: 18, travelDistance: 2,
    travelEfficiency: 0.9, estimatedMinutes: 3, bounds: { minX: 0, maxX: 10, minY: 0, maxY: 4, minZ: -1, maxZ: 5 },
  },
});

const renderDialog = (status: PreflightResult['status'], action: 'copy' | 'download' = 'download') => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<PreflightDialog
    result={result(status)} settings={defaults} profile={profiles[0]} mode="contour"
    action={action} generating={false} gcodeMegabytes={null} closeButtonRef={createRef<HTMLButtonElement>()}
    onClose={onClose} onConfirm={onConfirm}
  />);
  return { onClose, onConfirm };
};

describe('PreflightDialog', () => {
  it('renders semantic status/check text and never interprets finding messages as HTML', () => {
    renderDialog('warnings');
    expect(screen.getByRole('dialog', { name: 'Preflight' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('1 preflight warning');
    expect(screen.getByText(/<img src=x/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('requires the warning acknowledgement button before Copy', () => {
    const { onConfirm } = renderDialog('warnings', 'copy');
    fireEvent.click(screen.getByRole('button', { name: 'Accept warnings & Copy G-code' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables confirmation for blocking findings', () => {
    const { onConfirm } = renderDialog('blocked');
    const confirm = screen.getByRole('button', { name: 'Download G-code' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not request lazy G-code work until passed preflight is confirmed', () => {
    const { onConfirm } = renderDialog('passed');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download G-code' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('supports Escape and traps Tab within the modal controls', () => {
    const { onClose } = renderDialog('passed');
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Back to editing' });
    const confirm = screen.getByRole('button', { name: 'Download G-code' });
    confirm.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
