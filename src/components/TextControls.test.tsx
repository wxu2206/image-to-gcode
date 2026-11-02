import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultTextLayout } from '../text/types';
import { TextControls } from './TextControls';

describe('TextControls', () => {
  it('announces document import warnings without making them urgent alerts', () => {
    render(<TextControls
      text="Hello"
      layout={defaultTextLayout}
      page={0}
      pageCount={1}
      sourcePages={2}
      importWarnings={['Formatting was reduced to plain text.']}
      onText={vi.fn()}
      onLayout={vi.fn()}
      onPage={vi.fn()}
    />);
    expect(screen.getByRole('status').textContent).toContain('Formatting was reduced to plain text.');
    expect(screen.getByRole('textbox', { name: 'Editable plain text' })).toBeTruthy();
  });
});
