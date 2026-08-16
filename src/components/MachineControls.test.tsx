import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { defaults, profiles } from '../core/machine';
import type { MachineProfile, Settings } from '../core/types';
import { MachineControls } from './MachineControls';

function Harness({ initial = profiles[0], onSetting = vi.fn() }: { initial?: MachineProfile; onSetting?: (key: keyof Settings, value: unknown) => void }) {
  const [profile, setProfile] = useState(initial);
  return <MachineControls
    settings={defaults}
    profile={profile}
    rasterSource
    onSetting={onSetting}
    onUnits={() => {}}
    onProfile={(values) => setProfile((current) => ({ ...current, ...values }))}
  />;
}

describe('capability-driven machine controls', () => {
  it('keeps advanced settings collapsed and opening it has no processing callback', () => {
    const onSetting = vi.fn();
    render(<Harness onSetting={onSetting} />);
    const details = screen.getByText('Advanced settings').closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText('Advanced settings'));
    expect(details?.open).toBe(true);
    expect(onSetting).not.toHaveBeenCalled();
  });

  it('shows safe-Z controls for CNC and removes them after selecting a pen processor', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Advanced settings'));
    expect(screen.getByLabelText('Safe Z')).toBeTruthy();
    expect(screen.getByLabelText('Working depth')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Controller / output'), { target: { value: 'grbl-pen' } });
    expect(screen.queryByLabelText('Safe Z')).toBeNull();
    expect(screen.queryByLabelText('Working depth')).toBeNull();
    expect(screen.getByLabelText('Pen down')).toBeTruthy();
    expect(screen.getByLabelText('Pen up')).toBeTruthy();
  });

  it('keeps custom commands and advanced values editable', () => {
    render(<Harness initial={{ ...profiles[3], toolOn: 'DOWN', toolOff: 'UP' }} />);
    fireEvent.click(screen.getByText('Advanced settings'));
    fireEvent.change(screen.getByLabelText('Pen down'), { target: { value: 'M3 S40' } });
    fireEvent.change(screen.getByLabelText('Coordinate precision'), { target: { value: '4' } });
    expect((screen.getByLabelText('Pen down') as HTMLTextAreaElement).value).toBe('M3 S40');
    expect(screen.getByText('Custom commands are not fully simulated by preflight.')).toBeTruthy();
  });

  it('keeps frequent controls visible outside the disclosure', () => {
    render(<Harness initial={profiles[1]} />);
    expect(screen.getByLabelText('Controller / output')).toBeTruthy();
    expect(screen.getByLabelText('Work area width')).toBeTruthy();
    expect(screen.getByLabelText('Drawing speed')).toBeTruthy();
    expect(screen.getByLabelText('Travel speed')).toBeTruthy();
    expect(screen.getByLabelText('Noise cleanup')).toBeTruthy();
  });

  it('renders a recoverable selector when an active processor ID is malformed', () => {
    const malformed = { ...profiles[1], postProcessorId: 'removed-controller' } as unknown as MachineProfile;
    render(<Harness initial={malformed} />);
    expect(screen.getByText('Unavailable processor — select another')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Controller / output'), { target: { value: 'grbl-pen' } });
    expect((screen.getByLabelText('Controller / output') as HTMLSelectElement).value).toBe('grbl-pen');
  });
});
