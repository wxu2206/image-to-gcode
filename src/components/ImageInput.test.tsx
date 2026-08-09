import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageInput } from './ImageInput';

const file = (name: string, type: string) => new File(['image'], name, { type });

describe('ImageInput', () => {
  it.each([
    ['PNG', file('drawing.png', 'image/png')],
    ['JPEG', file('photo with spaces.JPG', 'image/jpeg')],
    ['WebP', file('odd [name] ü.webp', 'image/webp')],
  ])('accepts a valid %s file from the picker', async (_format, selected) => {
    const onFile = vi.fn().mockResolvedValue(undefined);
    render(<ImageInput variant="toolbar" onFile={onFile}/>);
    fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [selected] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(selected));
  });

  it('accepts one supported drag-and-drop file', async () => {
    const onFile = vi.fn().mockResolvedValue(undefined);
    render(<ImageInput variant="dropzone" onFile={onFile}/>);
    const zone = screen.getByRole('button', { name: /drop an image/i });
    const selected = file('dragged.png', 'image/png');
    fireEvent.dragEnter(zone, { dataTransfer: { files: [selected], items: [{ type: selected.type }], types: ['Files'] } });
    expect(zone.classList.contains('drag-active')).toBe(true);
    fireEvent.drop(zone, { dataTransfer: { files: [selected], items: [{ type: selected.type }], types: ['Files'] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(selected));
    expect(zone.classList.contains('drag-active')).toBe(false);
  });

  it('opens the file picker when the visible drop area is clicked', () => {
    render(<ImageInput variant="dropzone" onFile={vi.fn().mockResolvedValue(undefined)}/>);
    const input = screen.getByLabelText('Choose image');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: /drop an image/i }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('rejects unsupported and multiple files with useful errors', async () => {
    const onFile = vi.fn().mockResolvedValue(undefined);
    render(<ImageInput variant="dropzone" onFile={onFile}/>);
    const input = screen.getByLabelText('Choose image');
    fireEvent.change(input, { target: { files: [file('notes.txt', 'text/plain')] } });
    expect((await screen.findByRole('alert')).textContent).toContain('PNG, JPEG, or WebP');
    fireEvent.change(input, { target: { files: [file('one.png', 'image/png'), file('two.png', 'image/png')] } });
    expect((await screen.findByRole('alert')).textContent).toContain('exactly one');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('allows replacing an image and selecting the same file again', async () => {
    const onFile = vi.fn().mockResolvedValue(undefined);
    render(<ImageInput variant="toolbar" onFile={onFile}/>);
    const input = screen.getByLabelText('Choose image');
    const first = file('same.png', 'image/png');
    const second = file('replacement.jpg', 'image/jpeg');
    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(3));
    expect(onFile).toHaveBeenLastCalledWith(second);
  });

  it('recovers after a decoding failure', async () => {
    const onFile = vi.fn().mockRejectedValueOnce(new Error('Image decoding failed.')).mockResolvedValueOnce(undefined);
    render(<ImageInput variant="toolbar" onFile={onFile}/>);
    const input = screen.getByLabelText('Choose image');
    fireEvent.change(input, { target: { files: [file('broken.png', 'image/png')] } });
    expect((await screen.findByRole('alert')).textContent).toContain('Image decoding failed.');
    fireEvent.change(input, { target: { files: [file('good.png', 'image/png')] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
