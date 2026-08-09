import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Copy, Download, Pause, Play, RotateCcw, Settings2, ZoomIn, ZoomOut } from 'lucide-react';
import { ImageInput } from './components/ImageInput';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { loadProfiles, loadSettings } from './core/machine';
import { estimateComplexity } from './core/complexity';
import type { ToolpathStats } from './core/gcode';
import type { ConversionMode, Move, PreviewQuality, Settings } from './core/types';
import { decodeImageFile, readImagePixels } from './image/loadImage';
import { applyWorkerProgress, initialProgress, isCurrentPreviewRequest, previewProgress, startingProgress, type PipelineProgress, type WorkerProgressMessage, type WorkerTimings } from './workers/progress';
import './style.css';

const numKeys = ['workWidth', 'workHeight', 'outputWidth', 'outputHeight', 'offsetX', 'offsetY', 'feed', 'travel', 'safeZ', 'workZ', 'maxDepth', 'passes', 'lineSpacing', 'precision', 'threshold', 'simplify', 'brightness', 'contrast'] as const;
const detailLabel = (value: number) => value <= 0.1 ? 'Very Fine' : value <= 0.2 ? 'Fine' : value <= 0.35 ? 'Normal' : value <= 0.5 ? 'Coarse' : value <= 0.75 ? 'Fast' : 'Very Fast';
const visibleGcodeLines = (code: string, search: string) => {
  if (!search) return { lines: code.split('\n', 2_000), start: 1 };
  const match = code.toLowerCase().indexOf(search.toLowerCase());
  if (match < 0) return { lines: [] as string[], start: 1 };
  const startOffset = code.lastIndexOf('\n', match) + 1;
  let start = 1;
  for (let index = 0; index < startOffset; index += 1) if (code.charCodeAt(index) === 10) start += 1;
  return { lines: code.slice(startOffset).split('\n', 200), start };
};
type RuntimeTimings = WorkerTimings & { transferMs: number; previewPreparationMs: number | null; previewSegments: number; previewMs: number | null };
type JobSummary = { id: number; warnings: string[] };
type LoadedGcode = { code: string; characters: number; lines: number };
type WorkerMessage =
  | WorkerProgressMessage
  | { type: 'result'; id: number; warnings: string[]; stats: ToolpathStats; timings: WorkerTimings; sentAt: number }
  | { type: 'preview-result'; id: number; requestId: number; moves: Move[]; segments: number; previewMs: number }
  | { type: 'gcode-result'; id: number; requestId: number; code: string; characters: number; lines: number }
  | { type: 'error'; id: number; message: string };

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [profiles, setProfiles] = useState(loadProfiles);
  const [profileId, setProfileId] = useState(() => localStorage.getItem('i2g-profile') || 'cnc');
  const profile = profiles.find((item) => item.id === profileId) || profiles[0];
  const [mode, setMode] = useState<ConversionMode>('raster');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [sourcePixels, setSourcePixels] = useState<ImageData | null>(null);
  const [name, setName] = useState('');
  const [jobResult, setJobResult] = useState<JobSummary | null>(null);
  const [previewMoves, setPreviewMoves] = useState<Move[] | null>(null);
  const [gcode, setGcode] = useState<LoadedGcode | null>(null);
  const [gcodeState, setGcodeState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [approvedExtremeKey, setApprovedExtremeKey] = useState<string | null>(null);
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
  const previewRequestRef = useRef(0);
  const gcodeRequestRef = useRef(0);
  const pendingGcodeAction = useRef<'inspect' | 'copy' | 'download' | null>(null);
  const nameRef = useRef('');
  const renderRef = useRef(0);
  const renderedPreviewRef = useRef<Move[] | null>(null);
  const cachedPreviewRef = useRef<{ moves: Move[]; workHeight: number; work: Path2D; travel: Path2D } | null>(null);
  const panFrameRef = useRef(0);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => localStorage.setItem('i2g-settings', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('i2g-profile', profileId), [profileId]);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => () => cancelAnimationFrame(panFrameRef.current), []);

  // Preview Quality deliberately does not appear in this memo. Its change requests
  // only an alternate preview stream from the already-completed worker job.
  const workerSettings = useMemo<Settings>(() => ({
    units: settings.units, workWidth: settings.workWidth, workHeight: settings.workHeight, outputWidth: settings.outputWidth, outputHeight: settings.outputHeight,
    lockAspect: settings.lockAspect, offsetX: settings.offsetX, offsetY: settings.offsetY, origin: settings.origin, invertX: settings.invertX, invertY: settings.invertY,
    feed: settings.feed, travel: settings.travel, safeZ: settings.safeZ, workZ: settings.workZ, maxDepth: settings.maxDepth, passes: settings.passes,
    lineSpacing: settings.lineSpacing, precision: settings.precision, threshold: settings.threshold, serpentine: settings.serpentine, simplify: settings.simplify,
    toolpathDetail: settings.toolpathDetail, previewQuality: 'balanced', brightness: settings.brightness, contrast: settings.contrast, invert: settings.invert, filter: settings.filter, fit: settings.fit,
  }), [settings.units, settings.workWidth, settings.workHeight, settings.outputWidth, settings.outputHeight, settings.lockAspect, settings.offsetX, settings.offsetY, settings.origin, settings.invertX, settings.invertY, settings.feed, settings.travel, settings.safeZ, settings.workZ, settings.maxDepth, settings.passes, settings.lineSpacing, settings.precision, settings.threshold, settings.serpentine, settings.simplify, settings.toolpathDetail, settings.brightness, settings.contrast, settings.invert, settings.filter, settings.fit]);
  const conversionSettings = useMemo(() => ({
    lineSpacing: workerSettings.lineSpacing, outputWidth: workerSettings.outputWidth, outputHeight: workerSettings.outputHeight,
    threshold: workerSettings.threshold, serpentine: workerSettings.serpentine, simplify: workerSettings.simplify,
    toolpathDetail: workerSettings.toolpathDetail, units: workerSettings.units,
  }), [workerSettings]);
  const complexity = useMemo(() => sourcePixels ? estimateComplexity(sourcePixels, workerSettings, mode) : null, [sourcePixels, workerSettings, mode]);
  const complexityKey = complexity && `${sourcePixels?.width}x${sourcePixels?.height}:${mode}:${workerSettings.toolpathDetail}:${workerSettings.lineSpacing}:${workerSettings.outputWidth}:${workerSettings.outputHeight}`;

  useEffect(() => {
    if (!sourcePixels) return;
    if (complexity?.level === 'extreme' && approvedExtremeKey !== complexityKey) {
      setPipeline({ label: 'Extreme job needs confirmation', value: 0, active: false });
      setWorkerError(`Estimated ${complexity.movements.toLocaleString()} movements. Recommended detail: ${complexity.recommendedDetail.toFixed(2)} mm or coarser.`);
      return;
    }
    const id = jobRef.current + 1;
    jobRef.current = id;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./workers/toolpath.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setJobResult(null);
    setPreviewMoves(null);
    setGcode(null);
    setGcodeState('idle');
    setStats(null);
    setTimings(null);
    setPipeline(startingProgress());
    setWorkerError(null);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== jobRef.current) return;
      if (message.type === 'progress') {
        if (message.stage === 'preview' && !isCurrentPreviewRequest(previewRequestRef.current, message.requestId)) return;
        if (message.stage === 'serialize' && !isCurrentPreviewRequest(gcodeRequestRef.current, message.requestId)) return;
        const next = applyWorkerProgress(jobRef.current, message);
        if (next) setPipeline(next);
      } else if (message.type === 'result') {
        setJobResult({ id: message.id, warnings: message.warnings });
        setStats(message.stats);
        setPipeline({ label: 'Preparing preview…', value: 0.9, active: true });
        setTimings({ ...message.timings, transferMs: Math.max(0, performance.timeOrigin + performance.now() - message.sentAt), previewPreparationMs: null, previewSegments: 0, previewMs: null });
      } else if (message.type === 'preview-result') {
        if (!isCurrentPreviewRequest(previewRequestRef.current, message.requestId)) return;
        setPreviewMoves(message.moves);
        setPipeline({ label: 'Rendering preview…', value: 0.94, active: true });
        setTimings((current) => current ? { ...current, previewPreparationMs: message.previewMs, previewSegments: message.segments } : current);
      } else if (message.type === 'gcode-result') {
        if (!isCurrentPreviewRequest(gcodeRequestRef.current, message.requestId)) return;
        const next = { code: message.code, characters: message.characters, lines: message.lines };
        setGcode(next);
        setGcodeState('ready');
        setPipeline({ label: 'Ready', value: 1, active: false });
        const action = pendingGcodeAction.current;
        pendingGcodeAction.current = null;
        if (action === 'copy') void navigator.clipboard.writeText(next.code);
        if (action === 'download') {
          const link = document.createElement('a');
          const url = URL.createObjectURL(new Blob([next.code], { type: 'text/plain' }));
          link.href = url; link.download = `${nameRef.current.replace(/\.[^.]+$/, '') || 'image'}-${mode}.gcode`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
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
      imageSettings: { brightness: workerSettings.brightness, contrast: workerSettings.contrast, invert: workerSettings.invert, filter: workerSettings.filter, threshold: workerSettings.threshold },
      conversionSettings, settings: workerSettings, profile, mode,
    }, [data.buffer]);
    return () => worker.terminate();
  }, [sourcePixels, workerSettings, profile, mode, conversionSettings, complexity, complexityKey, approvedExtremeKey]);

  useEffect(() => {
    if (!jobResult) return;
    const id = jobRef.current;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewMoves(null);
    setPipeline({ label: 'Preparing preview…', value: 0.9, active: true });
    workerRef.current?.postMessage({ type: 'prepare-preview', id, requestId, quality: settings.previewQuality });
  }, [jobResult, settings.previewQuality]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !image) return;
    const context = element.getContext('2d');
    if (!context) return;
    const width = element.width;
    const height = element.height;
    const scale = Math.min((width - 40) / settings.workWidth, (height - 40) / settings.workHeight) * zoom;
    const originX = (width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (height - settings.workHeight * scale) / 2 + pan.y;
    const clearAndFrame = () => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#101318'; context.fillRect(0, 0, width, height);
      context.strokeStyle = '#4d5968'; context.strokeRect(originX, originY, settings.workWidth * scale, settings.workHeight * scale);
      context.fillStyle = '#8795a8'; context.font = '11px monospace'; context.fillText('WORK AREA', originX + 6, originY + 14);
    };
    const stroke = (work: Path2D, travel: Path2D) => {
      context.save(); context.translate(originX, originY); context.scale(scale, scale);
      context.globalAlpha = .35; context.strokeStyle = '#586273'; context.lineWidth = .7 / scale; context.stroke(travel);
      context.globalAlpha = .9; context.strokeStyle = '#39d98a'; context.lineWidth = 1.2 / scale; context.stroke(work);
      context.restore(); context.globalAlpha = 1;
    };
    clearAndFrame();
    const cached = cachedPreviewRef.current;
    if (previewMoves !== null && cached?.moves === previewMoves && cached.workHeight === settings.workHeight) {
      stroke(cached.work, cached.travel);
      return;
    }
    const moves = previewMoves ?? [];
    const initialRender = previewMoves !== null && renderedPreviewRef.current !== previewMoves;
    if (initialRender) renderedPreviewRef.current = previewMoves;
    const generation = renderRef.current + 1;
    renderRef.current = generation;
    const started = performance.now();
    const completeWork = new Path2D();
    const completeTravel = new Path2D();
    let lastUiUpdate = started;
    let index = 0;
    let frame = 0;
    let cancelled = false;
    const finish = () => {
      if (cancelled || generation !== renderRef.current || !initialRender) return;
      cachedPreviewRef.current = { moves: previewMoves!, workHeight: settings.workHeight, work: completeWork, travel: completeTravel };
      setPipeline({ label: 'Ready', value: 1, active: false });
      setTimings((current) => current ? { ...current, previewMs: performance.now() - started } : current);
    };
    const draw = () => {
      const deadline = performance.now() + 8;
      const work = new Path2D();
      const travel = new Path2D();
      while (index < moves.length && performance.now() < deadline) {
        const move = moves[index++];
        const path = move.working ? work : travel;
        path.moveTo(move.from.x, settings.workHeight - move.from.y);
        path.lineTo(move.to.x, settings.workHeight - move.to.y);
      }
      completeWork.addPath(work); completeTravel.addPath(travel);
      stroke(work, travel);
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
  }, [image, previewMoves, settings.workWidth, settings.workHeight, zoom, pan]);

  useEffect(() => {
    const element = playbackCanvas.current;
    if (!element || !image) return;
    const context = element.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, element.width, element.height);
    const moves = previewMoves;
    if (!moves?.length) return;
    const move = moves[Math.min(moves.length - 1, Math.floor(moves.length * playbackProgress))];
    const scale = Math.min((element.width - 40) / settings.workWidth, (element.height - 40) / settings.workHeight) * zoom;
    const originX = (element.width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (element.height - settings.workHeight * scale) / 2 + pan.y;
    context.fillStyle = '#ffbd59';
    context.beginPath();
    context.arc(originX + move.to.x * scale, originY + (settings.workHeight - move.to.y) * scale, 4, 0, 7);
    context.fill();
  }, [image, previewMoves, settings.workWidth, settings.workHeight, zoom, pan, playbackProgress]);

  useEffect(() => {
    if (!playing || !previewMoves) return;
    const timer = window.setInterval(() => setPlaybackProgress((current) => {
      if (current >= 1) { setPlaying(false); return 1; }
      return current + 0.01;
    }), 100);
    return () => window.clearInterval(timer);
  }, [playing, previewMoves]);

  const upload = async (file: File) => {
    jobRef.current += 1;
    workerRef.current?.terminate();
    setImage(null); setSourcePixels(null); setJobResult(null); setPreviewMoves(null); setGcode(null); setGcodeState('idle'); setStats(null); setTimings(null);
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
  const queuePan = (next: { x: number; y: number }) => {
    pendingPanRef.current = next;
    if (panFrameRef.current) return;
    panFrameRef.current = requestAnimationFrame(() => {
      panFrameRef.current = 0;
      if (pendingPanRef.current) setPan(pendingPanRef.current);
    });
  };
  const saveGcode = (code: string) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, '') || 'image'}-${mode}.gcode`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const requestGcode = (action: 'inspect' | 'copy' | 'download') => {
    if (!jobResult) return;
    if (gcode) {
      if (action === 'copy') void navigator.clipboard.writeText(gcode.code);
      if (action === 'download') saveGcode(gcode.code);
      return;
    }
    const requestId = gcodeRequestRef.current + 1;
    gcodeRequestRef.current = requestId;
    pendingGcodeAction.current = action;
    setGcodeState('generating');
    setPipeline({ label: 'Generating G-code…', value: 0, active: true });
    workerRef.current?.postMessage({ type: 'serialize-gcode', id: jobResult.id, requestId });
  };
  const gcodeLines = useMemo(() => gcode ? visibleGcodeLines(gcode.code, search) : null, [gcode, search]);
  const timingTitle = timings && `Image ${timings.imageMs.toFixed(0)}ms · machine resolution ${timings.reductionMs.toFixed(0)}ms · extraction ${timings.extractionMs.toFixed(0)}ms · ordering ${timings.orderingMs.toFixed(0)}ms · movements ${timings.movementMs.toFixed(0)}ms · G-code ${timings.gcodeMs.toFixed(0)}ms · stats ${timings.statisticsMs.toFixed(0)}ms · transfer ${timings.transferMs.toFixed(0)}ms${timings.previewPreparationMs === null ? '' : ` · preview prep ${timings.previewPreparationMs.toFixed(0)}ms`}${timings.previewMs === null ? '' : ` · preview render ${timings.previewMs.toFixed(0)}ms`}`;

  return <main>
    <header><div className="brand"><Settings2 size={20} /> image<span>→</span>gcode <small>LOCAL CAM</small></div><div className="toolbar"><ImageInput variant="toolbar" onFile={upload} /><button disabled={!jobResult} onClick={() => requestGcode('download')}><Download size={16} /> Export G-code</button></div></header>
    <section className="layout">
      <aside className="sidebar"><h2>Job setup</h2><label>Conversion mode<select value={mode} onChange={(event) => setMode(event.target.value as ConversionMode)}><option value="raster">Raster / scanline</option><option value="contour">Contour / outline</option><option value="grayscale">Grayscale engraving</option></select></label><label>Machine profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="minor" onClick={() => { const custom = { ...profile, id: crypto.randomUUID(), name: `Custom ${profile.name}` }; setProfiles((current) => { const next = [...current, custom]; localStorage.setItem('i2g-profiles', JSON.stringify(next.filter((item) => !['cnc', 'pen', 'laser'].includes(item.id)))); return next; }); setProfileId(custom.id); }}>Duplicate profile</button><h3>Output & machine</h3><div className="grid"><label>Units<select value={settings.units} onChange={(event) => set('units', event.target.value as Settings['units'])}><option value="mm">Millimeters</option><option value="in">Inches</option></select></label><label>Origin<select value={settings.origin} onChange={(event) => set('origin', event.target.value as Settings['origin'])}><option value="bottom-left">Bottom left</option><option value="top-left">Top left</option><option value="center">Center</option></select></label>{numKeys.slice(0, 12).map((key) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" value={settings[key]} step={key.includes('Width') || key.includes('Height') ? 1 : 0.1} onChange={(event) => set(key, Number(event.target.value))} /></label>)}</div><label className="check"><input type="checkbox" checked={settings.lockAspect} onChange={(event) => set('lockAspect', event.target.checked)} /> Lock aspect ratio</label><label className="check"><input type="checkbox" checked={settings.invertX} onChange={(event) => set('invertX', event.target.checked)} /> Invert X</label><label className="check"><input type="checkbox" checked={settings.invertY} onChange={(event) => set('invertY', event.target.checked)} /> Invert Y</label><h3>Toolpath quality</h3><label className="detail-control" htmlFor="toolpath-detail"><span>Toolpath Detail <b>{detailLabel(settings.toolpathDetail)}</b></span><output>{settings.toolpathDetail.toFixed(2)} mm</output><input id="toolpath-detail" aria-describedby="toolpath-detail-help" type="range" min="0.1" max="1" step="0.05" value={settings.toolpathDetail} onChange={(event) => set('toolpathDetail', Number(event.target.value))} /><small id="toolpath-detail-help">Controls minimum physical detail in the generated toolpath. Higher values reduce movements, processing time, and file size.</small></label>{timings && <div className="complexity">{timings.movementCount.toLocaleString()} movements<br />{Math.round(timings.packedMovementBytes / 1024).toLocaleString()} KiB worker-packed<br />{gcode ? `${(gcode.characters / 1_000_000).toFixed(2)} MB G-code` : 'G-code generated on demand'}</div>}<label className="preview-quality"><span>Preview Quality</span><small>Canvas only — never changes G-code or statistics.</small><div role="group" aria-label="Preview Quality">{(['low', 'balanced', 'high', 'full'] as PreviewQuality[]).map((quality) => <button key={quality} type="button" className={settings.previewQuality === quality ? 'selected' : ''} aria-pressed={settings.previewQuality === quality} onClick={() => set('previewQuality', quality)}>{quality}</button>)}</div></label><h3>Image processing</h3><label>Filter<select value={settings.filter} onChange={(event) => set('filter', event.target.value as Settings['filter'])}><option value="grayscale">Grayscale</option><option value="threshold">Threshold</option><option value="edge">Edge detection</option><option value="dither">Dithering</option></select></label><div className="grid">{numKeys.slice(12).map((key) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" value={settings[key]} onChange={(event) => set(key, Number(event.target.value))} /></label>)}</div><label className="check"><input type="checkbox" checked={settings.invert} onChange={(event) => set('invert', event.target.checked)} /> Invert image</label><label className="check"><input type="checkbox" checked={settings.serpentine} onChange={(event) => set('serpentine', event.target.checked)} /> Serpentine scan</label></aside>
      <section className="workspace"><div className="workspace-head"><div>{name ? <><b>{name}</b> · {image?.naturalWidth} × {image?.naturalHeight}px · {(image!.naturalWidth / image!.naturalHeight).toFixed(2)}:1</> : 'No image loaded — import a file or drop it below'}</div><div className="iconbar"><button title="Zoom out" onClick={() => setZoom((value) => Math.max(0.3, value - 0.2))}><ZoomOut /></button><button title="Zoom in" onClick={() => setZoom((value) => value + 0.2)}><ZoomIn /></button><button title="Fit view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><RotateCcw /></button></div></div><div className="job-progress" title={timingTitle || undefined}><div className="progress-copy"><span>{pipeline.label}</span><b>{Math.round(pipeline.value * 100)}%</b></div><div className="progress-track" role="progressbar" aria-label="Toolpath processing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pipeline.value * 100)}><span style={{ width: `${pipeline.value * 100}%` }} /></div>{timings && <small>{timings.movementCount.toLocaleString()} moves · {Math.round(timings.packedMovementBytes / 1024).toLocaleString()} KiB packed · worker {(timings.totalMs / 1000).toFixed(2)} s{timings.previewMs === null ? '' : ` · preview ${(timings.previewMs / 1000).toFixed(2)} s`}</small>}</div><div className="canvas-wrap"><ImageInput variant="dropzone" onFile={upload}>{image ? <div className="toolpath-canvases" onClick={(event) => event.stopPropagation()}><canvas ref={canvas} width="1100" height="700" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }} onPointerMove={(event) => { if (drag.current) queuePan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} /><canvas ref={playbackCanvas} className="playback-canvas" width="1100" height="700" /></div> : undefined}</ImageInput></div><div className="playback"><button disabled={!previewMoves} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</button><input aria-label="Toolpath playback" type="range" min="0" max="1" step=".001" value={playbackProgress} onChange={(event) => setPlaybackProgress(Number(event.target.value))} /><button onClick={() => setPlaybackProgress(0)}><RotateCcw /></button><span>{Math.round(playbackProgress * 100)}%</span></div></section>
      <aside className="code"><div className="code-head"><h2>G-code inspector</h2><button disabled={!jobResult || gcodeState === 'generating'} onClick={() => requestGcode('copy')}><Copy size={15} /> {gcodeState === 'generating' ? 'Generating…' : 'Copy'}</button></div>{gcode ? <><input placeholder="Search G-code" value={search} onChange={(event) => setSearch(event.target.value)} /><p className="code-limit">{search ? 'Showing 200 lines from the match' : `Showing first ${Math.min(2_000, gcode.lines).toLocaleString()} of ${gcode.lines.toLocaleString()} lines`}</p><pre>{gcodeLines?.lines.map((line, index) => <div key={index} className={search && line.toLowerCase().includes(search.toLowerCase()) ? 'match' : ''}><i>{String((gcodeLines?.start ?? 1) + index).padStart(4, '0')}</i>{line}</div>)}</pre></> : <div className="gcode-empty"><p>{jobResult ? 'G-code is ready to generate on demand.' : 'Import an image to prepare G-code.'}</p><button disabled={!jobResult || gcodeState === 'generating'} onClick={() => requestGcode('inspect')}>{gcodeState === 'generating' ? 'Generating G-code…' : 'Open G-code inspector'}</button></div>}</aside>
    </section>
    <footer>{complexity?.level === 'extreme' && approvedExtremeKey !== complexityKey && <div className="warning complexity-warning"><AlertTriangle size={15} />This setting estimates {complexity.movements.toLocaleString()} movements and may use significant memory. Recommended: ≥ {complexity.recommendedDetail.toFixed(2)} mm.<button onClick={() => setApprovedExtremeKey(complexityKey)}>Process anyway</button></div>}{workerError && <div className="warning"><AlertTriangle size={15} />{workerError}</div>}{jobResult?.warnings.map((warning) => <div className="warning" key={warning}><AlertTriangle size={15} />{warning}</div>)}{stats && jobResult && <div className="stats"><span>{stats.movementCount} commands</span><span>{stats.working} working / {stats.travels} travel moves</span><span>{stats.work.toFixed(1)} mm work</span><span>{stats.travel.toFixed(1)} mm travel</span><span>≈ {stats.time.toFixed(1)} min</span><span>X {stats.bounds?.minX.toFixed(1)}–{stats.bounds?.maxX.toFixed(1)} · Y {stats.bounds?.minY.toFixed(1)}–{stats.bounds?.maxY.toFixed(1)}</span></div>}<div className="safety"><AlertTriangle size={14} /> Always inspect G-code and verify your machine configuration. Previewing does not guarantee safe operation.</div></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
