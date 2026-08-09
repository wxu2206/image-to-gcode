import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Copy, Download, Pause, Play, RotateCcw, Settings2, ZoomIn, ZoomOut } from 'lucide-react';
import { ImageInput } from './components/ImageInput';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { defaults, loadProfiles } from './core/machine';
import type { ToolpathStats } from './core/gcode';
import type { ConversionMode, GcodeResult, Settings } from './core/types';
import { decodeImageFile, readImagePixels } from './image/loadImage';
import { applyWorkerProgress, initialProgress, previewProgress, startingProgress, type PipelineProgress, type WorkerProgressMessage, type WorkerTimings } from './workers/progress';
import './style.css';

const numKeys = ['workWidth', 'workHeight', 'outputWidth', 'outputHeight', 'offsetX', 'offsetY', 'feed', 'travel', 'safeZ', 'workZ', 'maxDepth', 'passes', 'lineSpacing', 'precision', 'threshold', 'simplify', 'brightness', 'contrast'] as const;
type RuntimeTimings = WorkerTimings & { transferMs: number; previewMs: number | null };
type WorkerMessage =
  | WorkerProgressMessage
  | { type: 'result'; id: number; result: GcodeResult; stats: ToolpathStats; timings: WorkerTimings; sentAt: number }
  | { type: 'error'; id: number; message: string };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...defaults, ...JSON.parse(localStorage.getItem('i2g-settings') || '{}') }));
  const [profiles, setProfiles] = useState(loadProfiles);
  const [profileId, setProfileId] = useState(() => localStorage.getItem('i2g-profile') || 'cnc');
  const profile = profiles.find((item) => item.id === profileId) || profiles[0];
  const [mode, setMode] = useState<ConversionMode>('raster');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [sourcePixels, setSourcePixels] = useState<ImageData | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<GcodeResult | null>(null);
  const [stats, setStats] = useState<ToolpathStats | null>(null);
  const [pipeline, setPipeline] = useState<PipelineProgress>(initialProgress);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [timings, setTimings] = useState<RuntimeTimings | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [playing, setPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [search, setSearch] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const playbackCanvas = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const renderRef = useRef(0);
  const renderedResultRef = useRef<GcodeResult | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => localStorage.setItem('i2g-settings', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('i2g-profile', profileId), [profileId]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const conversionSettings = useMemo(() => ({
    lineSpacing: settings.lineSpacing,
    outputHeight: settings.outputHeight,
    threshold: settings.threshold,
    serpentine: settings.serpentine,
    simplify: settings.simplify,
  }), [settings.lineSpacing, settings.outputHeight, settings.threshold, settings.serpentine, settings.simplify]);

  useEffect(() => {
    if (!sourcePixels) return;
    const id = jobRef.current + 1;
    jobRef.current = id;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./workers/toolpath.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setResult(null);
    setStats(null);
    setTimings(null);
    setPipeline(startingProgress());
    setWorkerError(null);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== jobRef.current) return;
      if (message.type === 'progress') {
        const next = applyWorkerProgress(jobRef.current, message);
        if (next) setPipeline(next);
      } else if (message.type === 'result') {
        setResult(message.result);
        setStats(message.stats);
        setPipeline({ label: 'Preparing preview…', value: 0.9, active: true });
        setTimings({ ...message.timings, transferMs: Math.max(0, performance.timeOrigin + performance.now() - message.sentAt), previewMs: null });
      } else if (message.type === 'error') {
        setWorkerError(message.message);
        setPipeline({ label: 'Processing failed', value: 0, active: false });
      }
    };
    worker.onerror = () => {
      if (id === jobRef.current) {
        setWorkerError('Toolpath worker stopped unexpectedly.');
        setPipeline({ label: 'Processing failed', value: 0, active: false });
      }
    };
    // Keep ImageData in React state for restarts; the per-job copy is then transferred,
    // not structured-cloned, to the worker.
    const data = sourcePixels.data.slice();
    worker.postMessage({
      type: 'run', id, pixels: { width: sourcePixels.width, height: sourcePixels.height, data: data.buffer },
      imageSettings: { brightness: settings.brightness, contrast: settings.contrast, invert: settings.invert, filter: settings.filter, threshold: settings.threshold },
      conversionSettings, settings, profile, mode,
    }, [data.buffer]);
    return () => worker.terminate();
  }, [sourcePixels, settings, profile, mode, conversionSettings]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !image) return;
    const context = element.getContext('2d');
    if (!context) return;
    const width = element.width;
    const height = element.height;
    context.fillStyle = '#101318';
    context.fillRect(0, 0, width, height);
    const scale = Math.min((width - 40) / settings.workWidth, (height - 40) / settings.workHeight) * zoom;
    const originX = (width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (height - settings.workHeight * scale) / 2 + pan.y;
    context.strokeStyle = '#4d5968';
    context.strokeRect(originX, originY, settings.workWidth * scale, settings.workHeight * scale);
    context.fillStyle = '#8795a8';
    context.font = '11px monospace';
    context.fillText('WORK AREA', originX + 6, originY + 14);

    const moves = result?.moves ?? [];
    const initialRender = result !== null && renderedResultRef.current !== result;
    if (initialRender) renderedResultRef.current = result;
    const generation = renderRef.current + 1;
    renderRef.current = generation;
    const started = performance.now();
    let lastUiUpdate = started;
    let index = 0;
    let frame = 0;
    let cancelled = false;
    const finish = () => {
      if (cancelled || generation !== renderRef.current || !initialRender) return;
      setPipeline({ label: 'Ready', value: 1, active: false });
      setTimings((current) => current ? { ...current, previewMs: performance.now() - started } : current);
    };
    const draw = () => {
      const deadline = performance.now() + 8;
      const workPath = new Path2D();
      const travelPath = new Path2D();
      while (index < moves.length && performance.now() < deadline) {
        const move = moves[index++];
        const path = move.working ? workPath : travelPath;
        path.moveTo(originX + move.from.x * scale, originY + (settings.workHeight - move.from.y) * scale);
        path.lineTo(originX + move.to.x * scale, originY + (settings.workHeight - move.to.y) * scale);
      }
      context.globalAlpha = 0.35;
      context.strokeStyle = '#586273';
      context.lineWidth = 0.7;
      context.stroke(travelPath);
      context.globalAlpha = 0.9;
      context.strokeStyle = '#39d98a';
      context.lineWidth = 1.2;
      context.stroke(workPath);
      context.globalAlpha = 1;
      if (initialRender && (performance.now() - lastUiUpdate > 80 || index === moves.length)) {
        lastUiUpdate = performance.now();
        setPipeline({ label: 'Rendering preview…', value: previewProgress(index, moves.length), active: index < moves.length });
      }
      if (index < moves.length && !cancelled) frame = requestAnimationFrame(draw);
      else finish();
    };
    if (moves.length) frame = requestAnimationFrame(draw);
    else finish();
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [image, result, settings.workWidth, settings.workHeight, zoom, pan]);

  useEffect(() => {
    const element = playbackCanvas.current;
    if (!element || !image) return;
    const context = element.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, element.width, element.height);
    const moves = result?.moves;
    if (!moves?.length) return;
    const move = moves[Math.min(moves.length - 1, Math.floor(moves.length * playbackProgress))];
    const scale = Math.min((element.width - 40) / settings.workWidth, (element.height - 40) / settings.workHeight) * zoom;
    const originX = (element.width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (element.height - settings.workHeight * scale) / 2 + pan.y;
    context.fillStyle = '#ffbd59';
    context.beginPath();
    context.arc(originX + move.to.x * scale, originY + (settings.workHeight - move.to.y) * scale, 4, 0, 7);
    context.fill();
  }, [image, result, settings.workWidth, settings.workHeight, zoom, pan, playbackProgress]);

  useEffect(() => {
    if (!playing || !result) return;
    const timer = window.setInterval(() => setPlaybackProgress((current) => {
      if (current >= 1) { setPlaying(false); return 1; }
      return current + 0.01;
    }), 100);
    return () => window.clearInterval(timer);
  }, [playing, result]);

  const upload = async (file: File) => {
    jobRef.current += 1;
    workerRef.current?.terminate();
    setImage(null); setSourcePixels(null); setResult(null); setStats(null); setTimings(null);
    setPipeline({ label: 'Decoding image…', value: 0, active: true });
    setWorkerError(null); setName(''); setPlaying(false); setPlaybackProgress(0);
    try {
      const decoded = await decodeImageFile(file);
      const pixels = readImagePixels(decoded);
      setImage(decoded); setSourcePixels(pixels); setName(file.name); setPan({ x: 0, y: 0 });
      if (settings.lockAspect) setSettings((current) => ({ ...current, outputHeight: current.outputWidth * decoded.naturalHeight / decoded.naturalWidth }));
    } catch (error) {
      setPipeline({ label: 'Image loading failed', value: 0, active: false });
      setWorkerError(error instanceof Error ? error.message : 'The image could not be loaded.');
      throw error;
    }
  };
  const set = (key: keyof Settings, value: unknown) => setSettings((current) => {
    const next = { ...current, [key]: value };
    if (current.lockAspect && image) {
      if (key === 'outputWidth') next.outputHeight = Number(value) * image.naturalHeight / image.naturalWidth;
      if (key === 'outputHeight') next.outputWidth = Number(value) * image.naturalWidth / image.naturalHeight;
    }
    return next;
  });
  const download = () => {
    if (!result) return;
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([result.code], { type: 'text/plain' }));
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, '') || 'image'}-${mode}.gcode`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const timingTitle = timings && `Image ${timings.imageMs.toFixed(0)}ms · extraction ${timings.extractionMs.toFixed(0)}ms · ordering ${timings.orderingMs.toFixed(0)}ms · movements ${timings.movementMs.toFixed(0)}ms · G-code ${timings.gcodeMs.toFixed(0)}ms · stats ${timings.statisticsMs.toFixed(0)}ms · transfer ${timings.transferMs.toFixed(0)}ms${timings.previewMs === null ? '' : ` · preview ${timings.previewMs.toFixed(0)}ms`}`;

  return <main>
    <header><div className="brand"><Settings2 size={20} /> image<span>→</span>gcode <small>LOCAL CAM</small></div><div className="toolbar"><ImageInput variant="toolbar" onFile={upload} /><button disabled={!result} onClick={download}><Download size={16} /> Export G-code</button></div></header>
    <section className="layout">
      <aside className="sidebar"><h2>Job setup</h2><label>Conversion mode<select value={mode} onChange={(event) => setMode(event.target.value as ConversionMode)}><option value="raster">Raster / scanline</option><option value="contour">Contour / outline</option><option value="grayscale">Grayscale engraving</option></select></label><label>Machine profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="minor" onClick={() => { const custom = { ...profile, id: crypto.randomUUID(), name: `Custom ${profile.name}` }; setProfiles((current) => { const next = [...current, custom]; localStorage.setItem('i2g-profiles', JSON.stringify(next.filter((item) => !['cnc', 'pen', 'laser'].includes(item.id)))); return next; }); setProfileId(custom.id); }}>Duplicate profile</button><h3>Output & machine</h3><div className="grid"><label>Units<select value={settings.units} onChange={(event) => set('units', event.target.value as Settings['units'])}><option value="mm">Millimeters</option><option value="in">Inches</option></select></label><label>Origin<select value={settings.origin} onChange={(event) => set('origin', event.target.value as Settings['origin'])}><option value="bottom-left">Bottom left</option><option value="top-left">Top left</option><option value="center">Center</option></select></label>{numKeys.slice(0, 12).map((key) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" value={settings[key]} step={key.includes('Width') || key.includes('Height') ? 1 : 0.1} onChange={(event) => set(key, Number(event.target.value))} /></label>)}</div><label className="check"><input type="checkbox" checked={settings.lockAspect} onChange={(event) => set('lockAspect', event.target.checked)} /> Lock aspect ratio</label><label className="check"><input type="checkbox" checked={settings.invertX} onChange={(event) => set('invertX', event.target.checked)} /> Invert X</label><label className="check"><input type="checkbox" checked={settings.invertY} onChange={(event) => set('invertY', event.target.checked)} /> Invert Y</label><h3>Image processing</h3><label>Filter<select value={settings.filter} onChange={(event) => set('filter', event.target.value as Settings['filter'])}><option value="grayscale">Grayscale</option><option value="threshold">Threshold</option><option value="edge">Edge detection</option><option value="dither">Dithering</option></select></label><div className="grid">{numKeys.slice(12).map((key) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" value={settings[key]} onChange={(event) => set(key, Number(event.target.value))} /></label>)}</div><label className="check"><input type="checkbox" checked={settings.invert} onChange={(event) => set('invert', event.target.checked)} /> Invert image</label><label className="check"><input type="checkbox" checked={settings.serpentine} onChange={(event) => set('serpentine', event.target.checked)} /> Serpentine scan</label></aside>
      <section className="workspace"><div className="workspace-head"><div>{name ? <><b>{name}</b> · {image?.naturalWidth} × {image?.naturalHeight}px · {(image!.naturalWidth / image!.naturalHeight).toFixed(2)}:1</> : 'No image loaded — import a file or drop it below'}</div><div className="iconbar"><button title="Zoom out" onClick={() => setZoom((value) => Math.max(0.3, value - 0.2))}><ZoomOut /></button><button title="Zoom in" onClick={() => setZoom((value) => value + 0.2)}><ZoomIn /></button><button title="Fit view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><RotateCcw /></button></div></div><div className="job-progress" title={timingTitle || undefined}><div className="progress-copy"><span>{pipeline.label}</span><b>{Math.round(pipeline.value * 100)}%</b></div><div className="progress-track" role="progressbar" aria-label="Toolpath processing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pipeline.value * 100)}><span style={{ width: `${pipeline.value * 100}%` }} /></div>{timings && <small>{timings.movementCount.toLocaleString()} moves · {(timings.gcodeCharacters / 1_000_000).toFixed(2)} MB G-code · worker {(timings.totalMs / 1000).toFixed(2)} s{timings.previewMs === null ? '' : ` · preview ${(timings.previewMs / 1000).toFixed(2)} s`}</small>}</div><div className="canvas-wrap"><ImageInput variant="dropzone" onFile={upload}>{image ? <div className="toolpath-canvases" onClick={(event) => event.stopPropagation()}><canvas ref={canvas} width="1100" height="700" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }} onPointerMove={(event) => { if (drag.current) setPan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} /><canvas ref={playbackCanvas} className="playback-canvas" width="1100" height="700" /></div> : undefined}</ImageInput></div><div className="playback"><button disabled={!result} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</button><input aria-label="Toolpath playback" type="range" min="0" max="1" step=".001" value={playbackProgress} onChange={(event) => setPlaybackProgress(Number(event.target.value))} /><button onClick={() => setPlaybackProgress(0)}><RotateCcw /></button><span>{Math.round(playbackProgress * 100)}%</span></div></section>
      <aside className="code"><div className="code-head"><h2>G-code inspector</h2><button disabled={!result} onClick={() => { if (result) void navigator.clipboard.writeText(result.code); }}><Copy size={15} /> Copy</button></div><input placeholder="Search G-code" value={search} onChange={(event) => setSearch(event.target.value)} /><pre>{result?.code.split('\n').map((line, index) => <div key={index} className={search && line.toLowerCase().includes(search.toLowerCase()) ? 'match' : ''}><i>{String(index + 1).padStart(4, '0')}</i>{line}</div>) || '; Import an image to generate G-code'}</pre></aside>
    </section>
    <footer>{workerError && <div className="warning"><AlertTriangle size={15} />{workerError}</div>}{result?.warnings.map((warning) => <div className="warning" key={warning}><AlertTriangle size={15} />{warning}</div>)}{stats && result && <div className="stats"><span>{result.moves.length} commands</span><span>{stats.working} working / {stats.travels} travel moves</span><span>{stats.work.toFixed(1)} mm work</span><span>{stats.travel.toFixed(1)} mm travel</span><span>≈ {stats.time.toFixed(1)} min</span><span>X {stats.bounds?.minX.toFixed(1)}–{stats.bounds?.maxX.toFixed(1)} · Y {stats.bounds?.minY.toFixed(1)}–{stats.bounds?.maxY.toFixed(1)}</span></div>}<div className="safety"><AlertTriangle size={14} /> Always inspect G-code and verify your machine configuration. Previewing does not guarantee safe operation.</div></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
