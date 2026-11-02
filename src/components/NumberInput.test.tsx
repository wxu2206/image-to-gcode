import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput } from './NumberInput';

describe('numeric presentation without computational rounding', () => {
  it('cleans a float tail without committing a rounded value on focus or blur', () => {
    const onValue = vi.fn();
    render(<NumberInput aria-label="Safe Z" value={4.999999999999999} onValue={onValue} />);
    const input = screen.getByLabelText('Safe Z') as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.focus(input); fireEvent.blur(input);
    expect(onValue).not.toHaveBeenCalled();
  });
  it('preserves small values and incomplete/precise editing drafts', () => {
    const onValue = vi.fn();
    function Harness() {
      const [value, setValue] = useState(1e-15);
      return <NumberInput aria-label="Offset" value={value} onValue={(next) => { onValue(next); setValue(next); }} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Offset') as HTMLInputElement;
    expect(Number(input.value)).toBe(1e-15);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(onValue).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '0.123456789012345' } });
    expect(input.value).toBe('0.123456789012345');
    expect(onValue).toHaveBeenLastCalledWith(0.123456789012345);
    fireEvent.blur(input);
    expect(input.value).toBe('0.123456789012');
  });
});
