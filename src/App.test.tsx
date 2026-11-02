import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate, statistics } from './core/gcode';
import { defaults, profiles } from './core/machine';
import type { Toolpath } from './core/types';
import { decodeImageFile, readImagePixels, readSvgFile } from './image/loadImage';
import { App } from './main';

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: vi.fn() }) }));
vi.mock('./image/loadImage', async (importOriginal) => ({
  ...await importOriginal<typeof import('./image/loadImage')>(),
  decodeImageFile: vi.fn(), readImagePixels: vi.fn(), readSvgFile: vi.fn(),
}));

const toolpath: Toolpath = { width: 10, height: 10, mode: 'contour', paths: [{ id: 'line', kind: 'work', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] };
const generated = generate(toolpath, defaults, profiles[0]);
const stats = statistics(generated.moves, undefined, { machineKind: 'cnc', safeZ: defaults.safeZ, precision: defaults.precision });
const timings = {
  imageMs: 0, reductionMs: 0, extractionMs: 0, orderingMs: 0, movementMs: 0, gcodeMs: 0,
  statisticsMs: 0, totalMs: 0, pathCount: 1, pointCount: 2, movementCount: stats.movementCount,
  gcodeCharacters: 0, packedMovementBytes: 0, transferBytes: 0, sourceSegmentCount: 1, flattenedPointCount: 2,
};

// Deterministic worker boundary: real canonical statistics, asynchronous messages,
// and tracked termination. This tests orchestration, not browser canvas rendering.
class TestWorker {
  static instances: TestWorker[] = [];
  static timedPreview = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  runId = 0;
  previewRequestId = 0;
  terminate = vi.fn(() => { this.terminated = true; });
  constructor() { TestWorker.instances.push(this); }
  postMessage(request: { type: string; id: number; requestId?: number; outputKey?: string }) {
    if (request.type === 'run') this.runId = request.id;
    if (request.type === 'prepare-preview') this.previewRequestId = request.requestId ?? 0;
    queueMicrotask(() => {
      if (this.terminated) return;
      const send = (data: unknown) => this.onmessage?.({ data } as MessageEvent);
      if (request.type === 'run') send({ type: 'result', id: request.id, warnings: [], stats, timings, sentAt: performance.timeOrigin + performance.now() });
      if (request.type === 'prepare-preview') {
        const moves = TestWorker.timedPreview ? generated.moves : [];
        const endMinutes = Float64Array.from(moves, (_, index) => (index + 1) * 0.3 / moves.length);
        send({ type: 'preview-result', id: request.id, requestId: request.requestId, moves, timing: { endMinutes: endMinutes.buffer, totalMinutes: TestWorker.timedPreview ? 0.3 : 0 }, segments: moves.length, previewMs: 0 });
      }
      if (request.type === 'serialize-gcode') send({ type: 'gcode-result', id: request.id, requestId: request.requestId, outputKey: request.outputKey, code: generated.code, characters: generated.code.length, lines: generated.code.trim().split('\n').length });
      if (request.type === 'extract') send({ type: 'error', id: request.id, message: 'Corrupt document fixture.' });
    });
  }
}

const picker = (label: string) => screen.getAllByLabelText(label)[0];
const choose = (file: File, label = 'Choose image or SVG') => fireEvent.change(picker(label), { target: { files: [file] } });
const openInspector = async () => {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open G-code inspector' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Open G-code inspector' }));
  await screen.findByRole('textbox', { name: 'Search G-code' });
};

beforeEach(() => {
  localStorage.clear();
  TestWorker.instances = [];
  TestWorker.timedPreview = false;
  vi.stubGlobal('Worker', TestWorker);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(decodeImageFile).mockResolvedValue({ naturalWidth: 10, naturalHeight: 10, removeAttribute: vi.fn() } as unknown as HTMLImageElement);
  vi.mocked(readImagePixels).mockReturnValue({ width: 10, height: 10, data: new Uint8ClampedArray(400) } as ImageData);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('App workflow regressions', () => {
  it.each(['during playback', 'after completion', 'after clearing text'])('invalidates elapsed time and obsolete animation callbacks %s', async (scenario) => {
    TestWorker.timedPreview = true;
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    render(<App />);
    fireEvent.change(screen.getByLabelText('Source workflow'), { target: { value: 'document' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable plain text' }), { target: { value: 'PLAY THIS' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Play toolpath playback' }) as HTMLButtonElement).disabled).toBe(false));
    const obsoleteWorker = TestWorker.instances[TestWorker.instances.length - 1];
    fireEvent.click(screen.getByRole('button', { name: 'Play toolpath playback' }));
    const stale = callbacks[callbacks.length - 1];
    await act(async () => stale(performance.now() + (scenario === 'after completion' ? 20_000 : 9_000)));
    expect(screen.queryByText('0:00 / 0:00')).toBeNull();
    if (scenario === 'after clearing text') fireEvent.change(screen.getByRole('textbox', { name: 'Editable plain text' }), { target: { value: '' } });
    else fireEvent.change(screen.getByLabelText('Source workflow'), { target: { value: 'artwork' } });
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy();
    await act(async () => stale(performance.now() + 60_000));
    await act(async () => {
      obsoleteWorker.onmessage?.({ data: { type: 'result', id: obsoleteWorker.runId, warnings: [], stats, timings, sentAt: performance.timeOrigin + performance.now() } } as MessageEvent);
      obsoleteWorker.onmessage?.({ data: { type: 'preview-result', id: obsoleteWorker.runId, requestId: obsoleteWorker.previewRequestId, moves: generated.moves,
        timing: { endMinutes: Float64Array.from(generated.moves, (_, index) => (index + 1) * 0.3 / generated.moves.length).buffer, totalMinutes: 0.3 }, segments: generated.moves.length, previewMs: 0 } } as MessageEvent);
    });
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Play toolpath playback' }) as HTMLButtonElement).disabled).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });

  it('keeps search summaries accurate when matching, clearing and regenerating text G-code', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Source workflow'), { target: { value: 'document' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable plain text' }), { target: { value: 'ONE' } });
    await openInspector();
    const search = screen.getByRole('textbox', { name: 'Search G-code' });
    fireEvent.change(search, { target: { value: 'NO_MATCH_TEST' } });
    expect(screen.getByText('No matching G-code lines')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'G21' } });
    expect(screen.getByText(/Showing \d+ lines from the match/)).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText(/Showing \d+ lines from the start/)).toBeTruthy();
    fireEvent.change(search, { target: { value: 'NO_MATCH_TEST' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable plain text' }), { target: { value: 'TWO' } });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search G-code' })).toBeNull());
    await openInspector();
    expect(screen.getByText('No matching G-code lines')).toBeTruthy();
  });

  it('shows clean Safe Z and preflight values after repeated unit changes', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Advanced settings'));
    for (let index = 0; index < 10; index += 1) {
      fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'in' } });
      fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'mm' } });
    }
    expect((screen.getByLabelText('Safe Z') as HTMLInputElement).value).toBe('5');
    expect(JSON.parse(localStorage.getItem('i2g-settings')!).safeZ).toBe(5);
    choose(new File(['fixture'], 'good.png', { type: 'image/png' }));
    await openInspector();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('dialog').textContent).not.toContain('4.999999999');
  });

  it('keeps the empty preview keyboard-accessible for browsing before a source is loaded', () => {
    render(<App />);
    const input = screen.getAllByLabelText('Choose image or SVG')[1];
    const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByRole('button', { name: /Toolpath preview/ }), { key: 'Enter' });
    expect(click).toHaveBeenCalledOnce();
  });

  it('keeps the completed job and inspector after a replacement image fails, with one error announcement', async () => {
    render(<App />);
    choose(new File(['fixture'], 'good.png', { type: 'image/png' }));
    await openInspector();
    const worker = TestWorker.instances[TestWorker.instances.length - 1];
    vi.mocked(decodeImageFile).mockRejectedValueOnce(new Error('Corrupt image fixture.'));
    choose(new File(['bad'], 'bad.png', { type: 'image/png' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Corrupt image fixture.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('good.png')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search G-code' })).toBeTruthy();
    expect(worker.terminate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search G-code' }), { target: { value: 'missing-command' } });
    expect(screen.getByText('No matching G-code lines').getAttribute('role')).toBe('status');
  });

  it('keeps editable text, its completed worker, and export available after a document import fails', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Source workflow'), { target: { value: 'document' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable plain text' }), { target: { value: 'Keep this text' } });
    await openInspector();
    const worker = TestWorker.instances[TestWorker.instances.length - 1];
    const file = new File(['bad'], 'bad.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) });
    choose(file, 'Choose DOCX or PDF');
    expect((await screen.findByRole('alert')).textContent).toContain('Corrupt document fixture.');
    expect((screen.getByRole('textbox', { name: 'Editable plain text' }) as HTMLTextAreaElement).value).toBe('Keep this text');
    expect(screen.getByRole('textbox', { name: 'Search G-code' })).toBeTruthy();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Download page 1' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a stale SVG read after the user switches workflows', async () => {
    let resolveRead!: (source: string) => void;
    vi.mocked(readSvgFile).mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    render(<App />);
    choose(new File(['svg'], 'old.svg', { type: 'image/svg+xml' }));
    fireEvent.change(screen.getByLabelText('Source workflow'), { target: { value: 'document' } });
    await act(async () => resolveRead('malformed SVG that must never be parsed'));
    expect(screen.getByRole('textbox', { name: 'Editable plain text' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Waiting for text or document…')).toBeTruthy();
  });

  it('clears a failed clipboard alert and announces a successful retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<App />);
    choose(new File(['fixture'], 'good.png', { type: 'image/png' }));
    await openInspector();
    const copy = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      fireEvent.click(screen.getByRole('button', { name: /Accept warnings & Copy G-code/ }));
    };
    copy();
    expect((await screen.findByRole('alert')).textContent).toContain('could not copy');
    copy();
    await screen.findByText('G-code copied to the clipboard.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});
