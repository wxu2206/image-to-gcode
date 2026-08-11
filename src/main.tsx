import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Copy, Download, Pause, Play, RotateCcw, Settings2, ZoomIn, ZoomOut } from 'lucide-react';
import { ImageInput } from './components/ImageInput';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { loadProfiles, loadSettings } from './core/machine';
import { estimateComplexity } from './core/complexity';
import type { ToolpathStats } from './core/gcode';
import type { ConversionMode, Move, PreviewQuality, Settings } from './core/types';
import { decodeImageFile, readImagePixels } from './image/loadImage';
import { applyWorkerProgress, initialProgress, isCurrentPreviewRequest, previewProgress, startingProgress, type PipelineProgress, type WorkerTimings } from './workers/progress';
import { fitViewport, zoomAtCursor, type Viewport } from './visualization/viewport';
import { activePathEndpoints, grayscaleToRgba, imagePlacementCorners, isCurrentProcessedPreview, processingPreviewKey, type PreviewMode, type ProcessedPreview } from './visualization/preview';
import { centerTransform, fitTransformToWorkArea, normalizeRotation } from './core/transform';
import { transformedBounds } from './core/transform';
import { machinePoint } from './core/geometry';
import { buildExportReview } from './core/exportReview';
import { canonicalJobKey, isCurrentJobRevision, isCurrentRevision } from './core/jobRevision';
import { convertSettingsUnits } from './core/units';
import { gcodeFilename } from './utils/filename';
import { isWorkerMessage, type WorkerMessage } from './workers/messages';
import './style.css';

const machineNumKeys = ['workWidth', 'workHeight', 'feed', 'travel', 'safeZ', 'workZ', 'maxDepth', 'passes', 'lineSpacing', 'precision'] as const;
const imageProcessNumKeys = ['threshold', 'simplify', 'brightness', 'contrast'] as const;
const readLocalSetting = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeLocalSetting = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* Persistence is optional; the active job remains usable. */ }
};
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
const downloadGcodeDocument = (code: string, filename: string) => {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([code], { type: 'text/x-gcode;charset=utf-8' }));
  try {
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
};
const copyGcodeDocument = (code: string) => {
  if (!navigator.clipboard?.writeText) return Promise.reject(new Error('Clipboard API unavailable.'));
  return navigator.clipboard.writeText(code);
};
type RuntimeTimings = WorkerTimings & { transferMs: number; previewPreparationMs: number | null; previewSegments: number; previewMs: number | null };
type JobSummary = { id: number; key: string; warnings: string[] };
type LoadedGcode = { jobId: number; key: string; code: string; characters: number; lines: number };
type LoadedImage = { naturalWidth: number; naturalHeight: number };
type RasterPreview = { width: number; height: number; data: Uint8ClampedArray; grayscale: boolean };

function PlacementControls({ settings, aspectRatio, update }: { settings: Settings; aspectRatio: number; update: (values: Partial<Settings>) => void }) {
  const resize = (key: 'outputWidth' | 'outputHeight', value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    update(settings.lockAspect
      ? key === 'outputWidth' ? { outputWidth: value, outputHeight: value / aspectRatio } : { outputWidth: value * aspectRatio, outputHeight: value }
      : { [key]: value });
  };
  const reset = () => update({ outputHeight: settings.outputWidth / aspectRatio, offsetX: 0, offsetY: 0, rotationDeg: 0 });
  return <><h3>Image placement</h3><div className="grid placement-grid"><label>Width ({settings.units})<input type="number" min="0.1" step="0.1" value={settings.outputWidth} onChange={(event) => resize('outputWidth', Number(event.target.value))} /></label><label>Height ({settings.units})<input type="number" min="0.1" step="0.1" value={settings.outputHeight} onChange={(event) => resize('outputHeight', Number(event.target.value))} /></label><label>X Position ({settings.units})<input type="number" step="0.1" value={settings.offsetX} onChange={(event) => update({ offsetX: Number(event.target.value) })} /></label><label>Y Position ({settings.units})<input type="number" step="0.1" value={settings.offsetY} onChange={(event) => update({ offsetY: Number(event.target.value) })} /></label><label>Rotation (°)<input type="number" min="-180" max="180" step="1" value={settings.rotationDeg} onChange={(event) => update({ rotationDeg: normalizeRotation(Number(event.target.value)) })} /></label></div><label className="check"><input type="checkbox" checked={settings.lockAspect} onChange={(event) => update({ lockAspect: event.target.checked })} /> Lock aspect ratio</label><div className="placement-actions"><button type="button" aria-label="Center image placement" onClick={() => update(centerTransform(settings))}>Center</button><button type="button" aria-label="Fit image to work area" onClick={() => update(fitTransformToWorkArea(settings, aspectRatio))}>Fit to work area</button><button type="button" aria-label="Rotate image left 90 degrees" title="Rotate image left 90 degrees" onClick={() => update({ rotationDeg: normalizeRotation(settings.rotationDeg - 90) })}>↶ 90°</button><button type="button" aria-label="Rotate image right 90 degrees" title="Rotate image right 90 degrees" onClick={() => update({ rotationDeg: normalizeRotation(settings.rotationDeg + 90) })}>↷ 90°</button><button type="button" aria-label="Reset image placement" onClick={reset}>Reset placement</button></div></>;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [profiles, setProfiles] = useState(loadProfiles);
  const [profileId, setProfileId] = useState(() => {
    const stored = readLocalSetting('i2g-profile') || 'cnc';
    return profiles.some((item) => item.id === stored) ? stored : 'cnc';
  });
  const profile = profiles.find((item) => item.id === profileId) || profiles[0];
  const [mode, setMode] = useState<ConversionMode>('raster');
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [sourcePixels, setSourcePixels] = useState<ImageData | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [name, setName] = useState('');
  const [jobResult, setJobResult] = useState<JobSummary | null>(null);
  const [previewMoves, setPreviewMoves] = useState<Move[] | null>(null);
  const [processedPreview, setProcessedPreview] = useState<ProcessedPreview | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('toolpath');
  const [showTravel, setShowTravel] = useState(true);
  const [showEndpoints, setShowEndpoints] = useState(true);
  const [gcode, setGcode] = useState<LoadedGcode | null>(null);
  const [gcodeState, setGcodeState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [approvedExtremeKey, setApprovedExtremeKey] = useState<string | null>(null);
  const [stats, setStats] = useState<ToolpathStats | null>(null);
  const [pipeline, setPipeline] = useState<PipelineProgress>(initialProgress);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [timings, setTimings] = useState<RuntimeTimings | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [editPlacement, setEditPlacement] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [stablePlacement, setStablePlacement] = useState(() => ({ outputWidth: settings.outputWidth, outputHeight: settings.outputHeight, offsetX: settings.offsetX, offsetY: settings.offsetY, rotationDeg: settings.rotationDeg }));
  const [playing, setPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [search, setSearch] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const playbackCanvas = useRef<HTMLCanvasElement>(null);
  const reviewCloseButton = useRef<HTMLButtonElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const previewRequestRef = useRef(0);
  const gcodeRequestRef = useRef(0);
  const pendingGcodeAction = useRef<{ action: 'inspect' | 'copy' | 'download'; key: string } | null>(null);
  const uploadRequestRef = useRef(0);
  const currentJobKeyRef = useRef<string | null>(null);
  const nameRef = useRef('');
  const renderRef = useRef(0);
  const renderedPreviewRef = useRef<Move[] | null>(null);
  const cachedPreviewRef = useRef<{ moves: Move[]; workHeight: number; work: Path2D; travel: Path2D } | null>(null);
  const rasterCanvasRef = useRef<{ data: Uint8ClampedArray; grayscale: boolean; canvas: HTMLCanvasElement } | null>(null);
  const panFrameRef = useRef(0);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const viewportFrameRef = useRef(0);
  const pendingViewportRef = useRef<Viewport | null>(null);
  const fittedJobRef = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const placementDrag = useRef<{ action: 'move' | 'resize'; x: number; y: number; offsetX: number; offsetY: number; width: number; height: number; centerX: number; centerY: number } | null>(null);

  useEffect(() => writeLocalSetting('i2g-settings', JSON.stringify(settings)), [settings]);
  useEffect(() => writeLocalSetting('i2g-profile', profileId), [profileId]);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => () => cancelAnimationFrame(panFrameRef.current), []);
  useEffect(() => () => cancelAnimationFrame(viewportFrameRef.current), []);
  useEffect(() => {
    if (!reviewOpen) return;
    reviewCloseButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setReviewOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [reviewOpen]);
  useEffect(() => {
    const timer = window.setTimeout(() => setStablePlacement({ outputWidth: settings.outputWidth, outputHeight: settings.outputHeight, offsetX: settings.offsetX, offsetY: settings.offsetY, rotationDeg: settings.rotationDeg }), 160);
    return () => window.clearTimeout(timer);
  }, [settings.outputWidth, settings.outputHeight, settings.offsetX, settings.offsetY, settings.rotationDeg]);

  // Preview Quality deliberately does not appear in this memo. Its change requests
  // only an alternate preview stream from the already-completed worker job.
  const workerSettings = useMemo<Settings>(() => ({
    units: settings.units, workWidth: settings.workWidth, workHeight: settings.workHeight, outputWidth: stablePlacement.outputWidth, outputHeight: stablePlacement.outputHeight,
    lockAspect: false, offsetX: stablePlacement.offsetX, offsetY: stablePlacement.offsetY, rotationDeg: stablePlacement.rotationDeg, origin: settings.origin, invertX: settings.invertX, invertY: settings.invertY,
    feed: settings.feed, travel: settings.travel, safeZ: settings.safeZ, workZ: settings.workZ, maxDepth: settings.maxDepth, passes: settings.passes,
    lineSpacing: settings.lineSpacing, precision: settings.precision, threshold: settings.threshold, serpentine: settings.serpentine, simplify: settings.simplify,
    toolpathDetail: settings.toolpathDetail, previewQuality: 'balanced', brightness: settings.brightness, contrast: settings.contrast, invert: settings.invert, filter: settings.filter, fit: false,
  }), [settings.units, settings.workWidth, settings.workHeight, stablePlacement, settings.origin, settings.invertX, settings.invertY, settings.feed, settings.travel, settings.safeZ, settings.workZ, settings.maxDepth, settings.passes, settings.lineSpacing, settings.precision, settings.threshold, settings.serpentine, settings.simplify, settings.toolpathDetail, settings.brightness, settings.contrast, settings.invert, settings.filter]);
  const complexity = useMemo(() => sourcePixels ? estimateComplexity(sourcePixels, workerSettings, mode) : null, [sourcePixels, workerSettings, mode]);
  const complexityKey = useMemo(() => complexity
    ? JSON.stringify([sourceRevision, mode, workerSettings.units, workerSettings.toolpathDetail, workerSettings.lineSpacing, workerSettings.outputWidth, workerSettings.outputHeight, workerSettings.passes])
    : null, [complexity, sourceRevision, mode, workerSettings]);
  const jobKey = useMemo(() => sourcePixels
    ? canonicalJobKey(sourceRevision, workerSettings, profile, mode)
    : null, [sourcePixels, sourceRevision, workerSettings, profile, mode]);
  currentJobKeyRef.current = jobKey;
  const processedKey = sourcePixels ? processingPreviewKey(sourceRevision, settings) : null;
  const currentProcessedPreview = isCurrentProcessedPreview(processedPreview, processedKey) ? processedPreview : null;
  const placementPending = settings.outputWidth !== stablePlacement.outputWidth || settings.outputHeight !== stablePlacement.outputHeight || settings.offsetX !== stablePlacement.offsetX || settings.offsetY !== stablePlacement.offsetY || settings.rotationDeg !== stablePlacement.rotationDeg;
  const currentJobResult = isCurrentJobRevision(jobResult, jobRef.current, jobKey) ? jobResult : null;
  const currentStats = currentJobResult ? stats : null;
  const currentTimings = currentJobResult ? timings : null;
  const currentPreviewMoves = currentJobResult ? previewMoves : null;
  const currentGcode = currentJobResult && isCurrentRevision(gcode?.key, jobKey) && gcode?.jobId === currentJobResult.id ? gcode : null;
  const reviewedRevisionCurrent = !reviewOpen || reviewKey === jobKey;
  const validWorkArea = Number.isFinite(settings.workWidth) && Number.isFinite(settings.workHeight) && settings.workWidth > 0 && settings.workHeight > 0;
  const imagePreviewBounds = useMemo(() => image && validWorkArea && Number.isFinite(settings.outputWidth) && Number.isFinite(settings.outputHeight) && settings.outputWidth > 0 && settings.outputHeight > 0
    ? transformedBounds(settings)
    : null, [image, validWorkArea, settings]);
  const review = useMemo(() => buildExportReview({
    settings,
    stats: currentStats,
    profile,
    warnings: currentJobResult?.warnings ?? [],
    placementPending,
    current: Boolean(currentJobResult) && reviewedRevisionCurrent,
  }), [settings, currentStats, profile, currentJobResult, placementPending, reviewedRevisionCurrent]);

  useEffect(() => {
    if (!sourcePixels || !jobKey) return;
    const id = jobRef.current + 1;
    jobRef.current = id;
    workerRef.current?.terminate();
    setJobResult(null);
    setPreviewMoves(null);
    setGcode(null);
    setGcodeState('idle');
    setStats(null);
    setTimings(null);
    setPlaying(false);
    setPlaybackProgress(0);
    pendingGcodeAction.current = null;
    if (complexity?.level === 'extreme' && approvedExtremeKey !== complexityKey) {
      setPipeline({ label: 'Extreme job needs confirmation', value: 0, active: false });
      setWorkerError(`Estimated ${complexity.movements.toLocaleString()} movements. Recommended detail: ${complexity.recommendedDetail.toFixed(2)} mm or coarser.`);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./workers/toolpath.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setPipeline({ label: 'Processing failed', value: 0, active: false });
      setWorkerError('This browser could not start the toolpath worker.');
      return;
    }
    workerRef.current = worker;
    setPipeline(startingProgress());
    setWorkerError(null);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message: unknown = event.data;
      if (worker !== workerRef.current) return;
      if (!isWorkerMessage(message)) {
        worker.terminate();
        setWorkerError('Toolpath worker returned an invalid response.');
        setPipeline({ label: 'Processing failed', value: 0, active: false });
        setGcodeState('error');
        setJobResult(null);
        setPreviewMoves(null);
        setProcessedPreview(null);
        setStats(null);
        setTimings(null);
        pendingGcodeAction.current = null;
        return;
      }
      if (message.id !== jobRef.current) return;
      if (jobKey !== currentJobKeyRef.current) return;
      if (message.type === 'progress') {
        if (message.stage === 'preview' && !isCurrentPreviewRequest(previewRequestRef.current, message.requestId)) return;
        if (message.stage === 'serialize' && !isCurrentPreviewRequest(gcodeRequestRef.current, message.requestId)) return;
        const next = applyWorkerProgress(jobRef.current, message);
        if (next) setPipeline(next);
      } else if (message.type === 'result') {
        setJobResult({ id: message.id, key: jobKey, warnings: message.warnings });
        setStats(message.stats);
        setPipeline({ label: 'Preparing preview…', value: 0.9, active: true });
        setTimings({ ...message.timings, transferMs: Math.max(0, performance.timeOrigin + performance.now() - message.sentAt), previewPreparationMs: null, previewSegments: 0, previewMs: null });
      } else if (message.type === 'processed-preview-result') {
        setProcessedPreview({
          jobId: message.id,
          jobKey,
          processingKey: processedKey!,
          width: message.preview.width,
          height: message.preview.height,
          data: new Uint8ClampedArray(message.preview.data),
        });
      } else if (message.type === 'preview-result') {
        if (!isCurrentPreviewRequest(previewRequestRef.current, message.requestId)) return;
        setPreviewMoves(message.moves);
        setPipeline({ label: 'Rendering preview…', value: 0.94, active: true });
        setTimings((current) => current ? { ...current, previewPreparationMs: message.previewMs, previewSegments: message.segments } : current);
      } else if (message.type === 'gcode-result') {
        if (!isCurrentPreviewRequest(gcodeRequestRef.current, message.requestId)) return;
        const next = { jobId: message.id, key: jobKey, code: message.code, characters: message.characters, lines: message.lines };
        setGcode(next);
        setGcodeState('ready');
        setPipeline({ label: 'Ready', value: 1, active: false });
        const pending = pendingGcodeAction.current;
        pendingGcodeAction.current = null;
        if (!pending || pending.key !== jobKey) return;
        if (pending.action === 'copy') void copyGcodeDocument(next.code).catch(() => setWorkerError('The browser could not copy G-code to the clipboard.'));
        if (pending.action === 'download') {
          try {
            downloadGcodeDocument(next.code, gcodeFilename(nameRef.current, mode));
          } catch {
            setWorkerError('The browser could not create the G-code download.');
          }
        }
      } else if (message.type === 'error') {
        if (message.requestId !== undefined) {
          const expected = message.stage === 'serialize' ? gcodeRequestRef.current : previewRequestRef.current;
          if (!isCurrentPreviewRequest(expected, message.requestId)) return;
        }
        setWorkerError(message.message);
        setPipeline({ label: 'Processing failed', value: 0, active: false });
        pendingGcodeAction.current = null;
        if (message.stage === 'serialize') setGcodeState('error');
        if (message.stage === 'run') {
          setJobResult(null);
          setPreviewMoves(null);
          setProcessedPreview(null);
          setStats(null);
          setTimings(null);
        }
      }
    };
    worker.onerror = () => {
      if (id === jobRef.current) {
        setWorkerError('Toolpath worker stopped unexpectedly.');
        setPipeline({ label: 'Processing failed', value: 0, active: false });
        setGcodeState('error');
        setJobResult(null);
        setPreviewMoves(null);
        setProcessedPreview(null);
        setStats(null);
        setTimings(null);
        pendingGcodeAction.current = null;
      }
    };
    // Keep ImageData in React state for restarts; the per-job copy is then transferred,
    // not structured-cloned, to the worker.
    const data = sourcePixels.data.slice();
    try {
      worker.postMessage({
        type: 'run', id, pixels: { width: sourcePixels.width, height: sourcePixels.height, data: data.buffer },
        settings: workerSettings, profile, mode,
      }, [data.buffer]);
    } catch {
      worker.terminate();
      setPipeline({ label: 'Processing failed', value: 0, active: false });
      setWorkerError('The toolpath job could not be sent to the worker.');
    }
    return () => worker.terminate();
  }, [sourcePixels, workerSettings, profile, mode, complexity, complexityKey, approvedExtremeKey, jobKey, processedKey]);

  useEffect(() => {
    if (!currentJobResult || !jobKey) return;
    const id = jobRef.current;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewMoves(null);
    setPipeline({ label: 'Preparing preview…', value: 0.9, active: true });
    try {
      workerRef.current?.postMessage({ type: 'prepare-preview', id, requestId, quality: settings.previewQuality });
    } catch {
      setPipeline({ label: 'Preview failed', value: 0.9, active: false });
      setWorkerError('The preview request could not be sent to the worker.');
    }
  }, [currentJobResult, jobKey, settings.previewQuality]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !image) return;
    const context = element.getContext('2d');
    if (!context) return;
    const width = element.width;
    const height = element.height;
    if (!validWorkArea) {
      context.fillStyle = '#101318';
      context.fillRect(0, 0, width, height);
      return;
    }
    const scale = Math.min((width - 40) / settings.workWidth, (height - 40) / settings.workHeight) * zoom;
    const originX = (width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (height - settings.workHeight * scale) / 2 + pan.y;
    const screen = (point: { x: number; y: number }) => ({ x: originX + point.x * scale, y: originY + (settings.workHeight - point.y) * scale });
    const clear = () => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#101318'; context.fillRect(0, 0, width, height);
      context.fillStyle = '#151d25'; context.fillRect(originX, originY, settings.workWidth * scale, settings.workHeight * scale);
    };
    const foreground = () => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.strokeStyle = '#4d5968'; context.lineWidth = 1; context.strokeRect(originX, originY, settings.workWidth * scale, settings.workHeight * scale);
      context.fillStyle = '#8795a8'; context.font = '11px monospace'; context.fillText('WORK AREA', originX + 6, originY + 14);
      const markerX = originX;
      const markerY = originY + settings.workHeight * scale;
      if (markerX > -12 && markerX < width + 12 && markerY > -12 && markerY < height + 12) {
        context.fillStyle = '#ffbd59'; context.beginPath(); context.arc(markerX, markerY, 3, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#c8a263'; context.fillText('0,0', markerX + 6, markerY - 6);
      }
      if (editPlacement) {
        const corners = [{ x: 0, y: 0 }, { x: settings.outputWidth, y: 0 }, { x: settings.outputWidth, y: settings.outputHeight }, { x: 0, y: settings.outputHeight }].map((point) => machinePoint(point, settings));
        context.strokeStyle = '#ffbd59'; context.lineWidth = 1.2; context.setLineDash([5, 4]); context.beginPath();
        corners.forEach((point, index) => { const mapped = screen(point); if (index) context.lineTo(mapped.x, mapped.y); else context.moveTo(mapped.x, mapped.y); });
        context.closePath(); context.stroke(); context.setLineDash([]);
        context.fillStyle = '#ffbd59';
        for (const point of corners) { const mapped = screen(point); context.fillRect(mapped.x - 3, mapped.y - 3, 6, 6); }
      }
    };
    const rasterCanvas = (raster: RasterPreview) => {
      const cached = rasterCanvasRef.current;
      if (cached?.data === raster.data && cached.grayscale === raster.grayscale) return cached.canvas;
      const bitmap = document.createElement('canvas');
      bitmap.width = raster.width; bitmap.height = raster.height;
      const bitmapContext = bitmap.getContext('2d');
      if (!bitmapContext) return null;
      const pixels = bitmapContext.createImageData(raster.width, raster.height);
      pixels.data.set(raster.grayscale ? grayscaleToRgba(raster.data) : raster.data);
      bitmapContext.putImageData(pixels, 0, 0);
      rasterCanvasRef.current = { data: raster.data, grayscale: raster.grayscale, canvas: bitmap };
      return bitmap;
    };
    const drawRaster = (raster: RasterPreview) => {
      const bitmap = rasterCanvas(raster);
      if (!bitmap) return;
      const corners = imagePlacementCorners(settings);
      const topLeft = screen(corners.topLeft);
      const topRight = screen(corners.topRight);
      const bottomLeft = screen(corners.bottomLeft);
      context.save();
      context.setTransform(
        (topRight.x - topLeft.x) / raster.width,
        (topRight.y - topLeft.y) / raster.width,
        (bottomLeft.x - topLeft.x) / raster.height,
        (bottomLeft.y - topLeft.y) / raster.height,
        topLeft.x,
        topLeft.y,
      );
      context.imageSmoothingEnabled = !raster.grayscale;
      context.drawImage(bitmap, 0, 0);
      context.restore();
    };
    const drawMessage = (message: string) => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#8f9dad'; context.font = '12px system-ui'; context.textAlign = 'center';
      context.fillText(message, width / 2, height / 2); context.textAlign = 'start';
    };
    const drawEndpoints = () => {
      if (!showEndpoints) return;
      const endpoints = activePathEndpoints(currentPreviewMoves);
      if (!endpoints) return;
      const draw = (point: { x: number; y: number }, color: string, label: string, filled: boolean) => {
        const mapped = screen(point);
        context.beginPath(); context.arc(mapped.x, mapped.y, 4, 0, Math.PI * 2);
        context.fillStyle = filled ? color : '#101318'; context.fill(); context.strokeStyle = color; context.lineWidth = 1.5; context.stroke();
        context.fillStyle = color; context.font = '10px monospace'; context.fillText(label, mapped.x + 7, mapped.y - 7);
      };
      draw(endpoints.start, '#39d98a', 'START', false);
      draw(endpoints.end, '#ffbd59', 'END', true);
    };
    const stroke = (work: Path2D, travel: Path2D) => {
      context.save(); context.translate(originX, originY); context.scale(scale, scale);
      if (showTravel) {
        context.globalAlpha = .28; context.strokeStyle = '#586273'; context.lineWidth = .7 / scale; context.stroke(travel);
      }
      context.globalAlpha = .9; context.strokeStyle = '#39d98a'; context.lineWidth = 1.2 / scale; context.stroke(work);
      context.restore(); context.globalAlpha = 1;
    };
    clear();
    const raster: RasterPreview | null = previewMode === 'original' && sourcePixels
      ? { width: sourcePixels.width, height: sourcePixels.height, data: sourcePixels.data, grayscale: false }
      : previewMode === 'processed' && currentProcessedPreview
        ? { width: currentProcessedPreview.width, height: currentProcessedPreview.height, data: currentProcessedPreview.data, grayscale: true }
        : null;
    if (previewMode !== 'toolpath') {
      if (raster) drawRaster(raster);
      else drawMessage('Processed preview is preparing…');
      foreground();
      return;
    }
    const cached = cachedPreviewRef.current;
    if (currentPreviewMoves !== null && cached?.moves === currentPreviewMoves && cached.workHeight === settings.workHeight) {
      stroke(cached.work, cached.travel); drawEndpoints(); foreground();
      return;
    }
    const moves = currentPreviewMoves ?? [];
    const initialRender = currentPreviewMoves !== null && renderedPreviewRef.current !== currentPreviewMoves;
    if (initialRender) renderedPreviewRef.current = currentPreviewMoves;
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
      cachedPreviewRef.current = { moves: currentPreviewMoves!, workHeight: settings.workHeight, work: completeWork, travel: completeTravel };
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
      stroke(work, travel); drawEndpoints(); foreground();
      if (initialRender && (performance.now() - lastUiUpdate > 80 || index === moves.length)) {
        lastUiUpdate = performance.now();
        setPipeline({ label: 'Rendering preview…', value: previewProgress(index, moves.length), active: index < moves.length });
      }
      if (index < moves.length && !cancelled) frame = requestAnimationFrame(draw);
      else finish();
    };
    if (moves.length) frame = requestAnimationFrame(draw);
    else { drawMessage(currentPreviewMoves ? 'No movements to preview.' : 'Toolpath preview is preparing…'); foreground(); finish(); }
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [image, sourcePixels, currentProcessedPreview, currentPreviewMoves, previewMode, showTravel, showEndpoints, settings, editPlacement, zoom, pan, validWorkArea]);

  useEffect(() => {
    const element = playbackCanvas.current;
    if (!element || !image) return;
    const context = element.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, element.width, element.height);
    if (!validWorkArea || previewMode !== 'toolpath') return;
    const moves = currentPreviewMoves;
    if (!moves?.length) return;
    const move = moves[Math.min(moves.length - 1, Math.floor(moves.length * playbackProgress))];
    const scale = Math.min((element.width - 40) / settings.workWidth, (element.height - 40) / settings.workHeight) * zoom;
    const originX = (element.width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (element.height - settings.workHeight * scale) / 2 + pan.y;
    context.fillStyle = '#ffbd59';
    context.beginPath();
    context.arc(originX + move.to.x * scale, originY + (settings.workHeight - move.to.y) * scale, 4, 0, 7);
    context.fill();
  }, [image, currentPreviewMoves, previewMode, settings.workWidth, settings.workHeight, zoom, pan, playbackProgress, validWorkArea]);

  useEffect(() => {
    if (previewMode !== 'toolpath') setPlaying(false);
  }, [previewMode]);

  useEffect(() => {
    if (!playing || !currentPreviewMoves || previewMode !== 'toolpath') return;
    const timer = window.setInterval(() => setPlaybackProgress((current) => {
      if (current >= 1) { setPlaying(false); return 1; }
      return current + 0.01;
    }), 100);
    return () => window.clearInterval(timer);
  }, [playing, currentPreviewMoves, previewMode]);

  const upload = async (file: File) => {
    const uploadId = uploadRequestRef.current + 1;
    uploadRequestRef.current = uploadId;
    jobRef.current += 1;
    workerRef.current?.terminate();
    setImage(null); setSourcePixels(null); setProcessedPreview(null); setJobResult(null); setPreviewMoves(null); setGcode(null); setGcodeState('idle'); setStats(null); setTimings(null);
    setPipeline({ label: 'Decoding image…', value: 0, active: true });
    setWorkerError(null); setName(''); setPlaying(false); setPlaybackProgress(0);
    try {
      const decoded = await decodeImageFile(file);
      const pixels = readImagePixels(decoded);
      const dimensions = { naturalWidth: decoded.naturalWidth, naturalHeight: decoded.naturalHeight };
      decoded.removeAttribute('src');
      if (uploadId !== uploadRequestRef.current) return;
      nameRef.current = file.name;
      setImage(dimensions); setSourcePixels(pixels); setName(file.name); setZoom(1); setPan({ x: 0, y: 0 });
      setSourceRevision((current) => current + 1);
      setSettings((current) => current.lockAspect
        ? { ...current, outputHeight: current.outputWidth * dimensions.naturalHeight / dimensions.naturalWidth }
        : current);
    } catch (error) {
      if (uploadId !== uploadRequestRef.current) return;
      setPipeline({ label: 'Image loading failed', value: 0, active: false });
      setWorkerError(error instanceof Error ? error.message : 'The image could not be loaded.');
      throw error;
    }
  };
  const changeUnits = (units: Settings['units']) => {
    const converted = convertSettingsUnits(settings, units);
    setSettings(converted);
    setStablePlacement({
      outputWidth: converted.outputWidth,
      outputHeight: converted.outputHeight,
      offsetX: converted.offsetX,
      offsetY: converted.offsetY,
      rotationDeg: converted.rotationDeg,
    });
  };
  const set = (key: keyof Settings, value: unknown) => setSettings((current) => {
    if (typeof current[key] === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return current;
    const next = { ...current, [key]: value };
    if (current.lockAspect && image) {
      if (key === 'outputWidth') next.outputHeight = Number(value) * image.naturalHeight / image.naturalWidth;
      if (key === 'outputHeight') next.outputWidth = Number(value) * image.naturalWidth / image.naturalHeight;
    }
    return next;
  });
  const updateTransform = (values: Partial<Settings>) => {
    if (Object.values(values).some((value) => typeof value === 'number' && !Number.isFinite(value))) return;
    setSettings((current) => ({ ...current, ...values }));
  };
  const queuePan = (next: { x: number; y: number }) => {
    pendingPanRef.current = next;
    if (panFrameRef.current) return;
    panFrameRef.current = requestAnimationFrame(() => {
      panFrameRef.current = 0;
      if (pendingPanRef.current) setPan(pendingPanRef.current);
    });
  };
  const queueViewport = (next: Viewport) => {
    pendingViewportRef.current = next;
    if (viewportFrameRef.current) return;
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = 0;
      const pending = pendingViewportRef.current;
      pendingViewportRef.current = null;
      if (pending) { setZoom(pending.zoom); setPan(pending.pan); }
    });
  };
  const viewportCanvas = () => {
    const element = canvas.current;
    return element ? { element, width: element.width, height: element.height } : null;
  };
  const zoomPreview = (factor: number, clientX?: number, clientY?: number) => {
    if (!validWorkArea) return;
    const target = viewportCanvas();
    if (!target) return;
    const rect = target.element.getBoundingClientRect();
    const cursor = clientX === undefined || clientY === undefined
      ? { x: target.width / 2, y: target.height / 2 }
      : { x: (clientX - rect.left) * target.width / rect.width, y: (clientY - rect.top) * target.height / rect.height };
    const current = pendingViewportRef.current ?? { zoom, pan };
    queueViewport(zoomAtCursor(current, cursor, factor, target, { width: settings.workWidth, height: settings.workHeight }));
  };
  const fitPreview = useCallback(() => {
    if (!validWorkArea) return;
    const target = viewportCanvas();
    if (!target) return;
    const bounds = previewMode === 'toolpath' ? currentStats?.bounds ?? null : imagePreviewBounds;
    const next = fitViewport(bounds, target, { width: settings.workWidth, height: settings.workHeight });
    pendingViewportRef.current = null;
    setZoom(next.zoom); setPan(next.pan);
  }, [previewMode, currentStats?.bounds, imagePreviewBounds, settings.workWidth, settings.workHeight, validWorkArea]);
  const handlePreviewWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const delta = Math.max(-100, Math.min(100, event.deltaY));
    zoomPreview(Math.exp(-delta * .0025), event.clientX, event.clientY);
  };
  const pointerMachinePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!validWorkArea) return null;
    const target = viewportCanvas();
    if (!target) return null;
    const rect = target.element.getBoundingClientRect();
    const x = (event.clientX - rect.left) * target.width / rect.width;
    const y = (event.clientY - rect.top) * target.height / rect.height;
    const scale = Math.min((target.width - 40) / settings.workWidth, (target.height - 40) / settings.workHeight) * zoom;
    const originX = (target.width - settings.workWidth * scale) / 2 + pan.x;
    const originY = (target.height - settings.workHeight * scale) / 2 + pan.y;
    return { x: (x - originX) / scale, y: settings.workHeight - (y - originY) / scale, scale };
  };
  const startPreviewPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerMachinePoint(event);
    if (editPlacement && point) {
      const bounds = transformedBounds(settings);
      const corners = [{ x: 0, y: 0 }, { x: settings.outputWidth, y: 0 }, { x: settings.outputWidth, y: settings.outputHeight }, { x: 0, y: settings.outputHeight }].map((corner) => machinePoint(corner, settings));
      const handle = corners.some((corner) => Math.hypot(corner.x - point.x, corner.y - point.y) <= 8 / point.scale);
      const within = point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
      if (handle || within) {
        event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('is-placing');
        placementDrag.current = { action: handle ? 'resize' : 'move', x: point.x, y: point.y, offsetX: settings.offsetX, offsetY: settings.offsetY, width: settings.outputWidth, height: settings.outputHeight, centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2 };
        return;
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('is-panning'); drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  };
  const movePreviewPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (placementDrag.current) {
      const point = pointerMachinePoint(event); const active = placementDrag.current;
      if (!point) return;
      if (active.action === 'move') updateTransform({ offsetX: active.offsetX + point.x - active.x, offsetY: active.offsetY + point.y - active.y });
      else {
        const startRadius = Math.max(.001, Math.hypot(active.x - active.centerX, active.y - active.centerY));
        const factor = Math.max(.02, Math.hypot(point.x - active.centerX, point.y - active.centerY) / startRadius);
        const aspect = image ? image.naturalWidth / image.naturalHeight : active.width / active.height;
        updateTransform(settings.lockAspect ? { outputWidth: active.width * factor, outputHeight: active.width * factor / aspect } : { outputWidth: active.width * factor, outputHeight: active.height * factor });
      }
      return;
    }
    if (drag.current) queuePan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y });
  };
  const endPreviewPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = null; placementDrag.current = null; event.currentTarget.classList.remove('is-panning', 'is-placing');
  };
  useEffect(() => {
    if (previewMode !== 'toolpath' || !currentJobResult || !currentStats?.bounds || fittedJobRef.current === currentJobResult.id) return;
    fittedJobRef.current = currentJobResult.id;
    fitPreview();
  }, [previewMode, currentJobResult, currentStats?.bounds, fitPreview]);
  const saveGcode = (code: string) => {
    try {
      downloadGcodeDocument(code, gcodeFilename(name, mode));
    } catch {
      setWorkerError('The browser could not create the G-code download.');
    }
  };
  const requestGcode = (action: 'inspect' | 'copy' | 'download', expectedKey?: string | null) => {
    if (!currentJobResult || !jobKey || placementPending || (expectedKey !== undefined && expectedKey !== jobKey)) return;
    if (action !== 'inspect' && review.level === 'blocking') {
      setWorkerError('Resolve blocking export issues before copying or downloading G-code.');
      return;
    }
    if (currentGcode) {
      if (action === 'copy') void copyGcodeDocument(currentGcode.code).catch(() => setWorkerError('The browser could not copy G-code to the clipboard.'));
      if (action === 'download') saveGcode(currentGcode.code);
      return;
    }
    const requestId = gcodeRequestRef.current + 1;
    gcodeRequestRef.current = requestId;
    pendingGcodeAction.current = { action, key: jobKey };
    setGcodeState('generating');
    setPipeline({ label: 'Generating G-code…', value: 0, active: true });
    try {
      workerRef.current?.postMessage({ type: 'serialize-gcode', id: currentJobResult.id, requestId });
    } catch {
      pendingGcodeAction.current = null;
      setGcodeState('error');
      setPipeline({ label: 'G-code generation failed', value: 0, active: false });
      setWorkerError('The G-code request could not be sent to the worker.');
    }
  };
  const gcodeLines = useMemo(() => currentGcode ? visibleGcodeLines(currentGcode.code, search) : null, [currentGcode, search]);
  const timingTitle = currentTimings && `Image ${currentTimings.imageMs.toFixed(0)}ms · machine resolution ${currentTimings.reductionMs.toFixed(0)}ms · extraction ${currentTimings.extractionMs.toFixed(0)}ms · ordering ${currentTimings.orderingMs.toFixed(0)}ms · movements ${currentTimings.movementMs.toFixed(0)}ms · G-code ${currentTimings.gcodeMs.toFixed(0)}ms · stats ${currentTimings.statisticsMs.toFixed(0)}ms · transfer ${currentTimings.transferMs.toFixed(0)}ms${currentTimings.previewPreparationMs === null ? '' : ` · preview prep ${currentTimings.previewPreparationMs.toFixed(0)}ms`}${currentTimings.previewMs === null ? '' : ` · preview render ${currentTimings.previewMs.toFixed(0)}ms`}`;

  return <div className="app">
    <header><div className="brand"><Settings2 size={20} /> image<span>→</span>gcode <small>LOCAL CAM</small></div><div className="toolbar"><ImageInput variant="toolbar" onFile={upload} /><button disabled={!currentJobResult || placementPending} title={placementPending ? 'Waiting for placement update' : undefined} onClick={() => { setReviewKey(jobKey); setReviewOpen(true); }}><Download size={16} /> Download G-code</button></div></header>
    <main className="layout">
      <aside className="sidebar"><h2>Job setup</h2><label>Conversion mode<select value={mode} onChange={(event) => setMode(event.target.value as ConversionMode)}><option value="raster">Raster / scanline</option><option value="contour">Contour / outline</option><option value="grayscale">Grayscale engraving</option></select></label><label>Machine profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="minor" onClick={() => { const custom = { ...profile, id: crypto.randomUUID(), name: `Custom ${profile.name}` }; setProfiles((current) => { const next = [...current, custom]; writeLocalSetting('i2g-profiles', JSON.stringify(next.filter((item) => !['cnc', 'pen', 'laser'].includes(item.id)))); return next; }); setProfileId(custom.id); }}>Duplicate profile</button>{image && <PlacementControls settings={settings} aspectRatio={image.naturalWidth / image.naturalHeight} update={updateTransform} />}<h3>Machine</h3><div className="grid"><label>Units<select value={settings.units} onChange={(event) => changeUnits(event.target.value as Settings['units'])}><option value="mm">Millimeters</option><option value="in">Inches</option></select></label><label>Origin<select value={settings.origin} onChange={(event) => set('origin', event.target.value as Settings['origin'])}><option value="bottom-left">Bottom left</option><option value="top-left">Top left</option><option value="center">Center</option></select></label>{machineNumKeys.map((key) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" value={settings[key]} step={key.includes('Width') || key.includes('Height') ? 1 : 0.1} onChange={(event) => set(key, Number(event.target.value))} /></label>)}</div><label className="check"><input type="checkbox" checked={settings.invertX} onChange={(event) => set('invertX', event.target.checked)} /> Invert X</label><label className="check"><input type="checkbox" checked={settings.invertY} onChange={(event) => set('invertY', event.target.checked)} /> Invert Y</label><h3>Toolpath quality</h3><label className="detail-control" htmlFor="toolpath-detail"><span>Toolpath Detail <b>{detailLabel(settings.toolpathDetail)}</b></span><output>{settings.toolpathDetail.toFixed(2)} mm</output><input id="toolpath-detail" aria-describedby="toolpath-detail-help" type="range" min="0.1" max="1" step="0.05" value={settings.toolpathDetail} onChange={(event) => set('toolpathDetail', Number(event.target.value))} /><small id="toolpath-detail-help">Controls minimum physical detail in the generated toolpath. Higher values reduce movements, processing time, and file size.</small></label>{currentTimings && <div className="complexity">{currentTimings.movementCount.toLocaleString()} movements<br />{Math.round(currentTimings.packedMovementBytes / 1024).toLocaleString()} KiB worker-packed<br />{currentGcode ? `${(currentGcode.characters / 1_000_000).toFixed(2)} MB G-code` : 'G-code generated on demand'}</div>}<label className="preview-quality"><span>Preview Quality</span><small>Canvas only — never changes G-code or statistics.</small><div role="group" aria-label="Preview Quality">{(['low', 'balanced', 'high', 'full'] as PreviewQuality[]).map((quality) => <button key={quality} type="button" className={settings.previewQuality === quality ? 'selected' : ''} aria-pressed={settings.previewQuality === quality} onClick={() => set('previewQuality', quality)}>{quality}</button>)}</div></label><h3>Image processing</h3><label>Filter<select value={settings.filter} onChange={(event) => set('filter', event.target.value as Settings['filter'])}><option value="grayscale">Grayscale</option><option value="threshold">Threshold</option><option value="edge">Edge detection</option><option value="dither">Dithering</option></select></label><div className="grid">{imageProcessNumKeys.map((key) => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input type="number" value={settings[key]} onChange={(event) => set(key, Number(event.target.value))} /></label>)}</div><label className="check"><input type="checkbox" checked={settings.invert} onChange={(event) => set('invert', event.target.checked)} /> Invert image</label><label className="check"><input type="checkbox" checked={settings.serpentine} onChange={(event) => set('serpentine', event.target.checked)} /> Serpentine scan</label></aside>
      <section className="workspace">
        <div className="workspace-head">
          <div className="file-meta">{name ? <><b>{name}</b> · {image?.naturalWidth} × {image?.naturalHeight}px · {(image!.naturalWidth / image!.naturalHeight).toFixed(2)}:1</> : 'No image loaded — import a file or drop it below'}</div>
          <div className="preview-tools">
            <div className="preview-modes" role="group" aria-label="Preview mode">
              {(['original', 'processed', 'toolpath'] as PreviewMode[]).map((candidate) => <button key={candidate} type="button" disabled={!image} className={previewMode === candidate ? 'selected' : ''} aria-pressed={previewMode === candidate} onClick={() => setPreviewMode(candidate)}>{candidate[0].toUpperCase()}{candidate.slice(1)}</button>)}
            </div>
            <div className="iconbar" aria-label="Viewport controls">
              {image && <button type="button" className={editPlacement ? 'selected' : ''} aria-pressed={editPlacement} title="Edit image placement" onClick={() => setEditPlacement((value) => !value)}>Edit placement</button>}
              <button type="button" title="Zoom out" aria-label="Zoom out" disabled={!image} onClick={() => zoomPreview(1 / 1.2)}><ZoomOut size={16} /></button>
              <output className="zoom-readout" aria-live="polite">{Math.round(zoom * 100)}%</output>
              <button type="button" title="Zoom in" aria-label="Zoom in" disabled={!image} onClick={() => zoomPreview(1.2)}><ZoomIn size={16} /></button>
              <button type="button" title="Fit current preview" aria-label="Fit current preview" disabled={!image} onClick={fitPreview}><RotateCcw size={16} /></button>
            </div>
          </div>
        </div>
        <div className="job-progress" title={timingTitle || undefined}><div className="progress-copy"><span>{pipeline.label}</span><b>{Math.round(pipeline.value * 100)}%</b></div><div className="progress-track"><progress aria-label="Toolpath processing progress" max="1" value={pipeline.value} /></div>{currentTimings && <small>{currentTimings.movementCount.toLocaleString()} moves · {Math.round(currentTimings.packedMovementBytes / 1024).toLocaleString()} KiB packed · worker {(currentTimings.totalMs / 1000).toFixed(2)} s{currentTimings.previewMs === null ? '' : ` · preview ${(currentTimings.previewMs / 1000).toFixed(2)} s`}</small>}</div>
        <div className="canvas-wrap"><ImageInput variant="dropzone" onFile={upload}>{image ? <div className="toolpath-canvases" onClick={(event) => event.stopPropagation()}>
          <canvas ref={canvas} width="1100" height="700" tabIndex={0} role="img" aria-label={editPlacement ? 'Image placement editor. Drag the image to move it or drag a corner handle to resize it. Scroll to zoom.' : `${previewMode[0].toUpperCase()}${previewMode.slice(1)} preview. Scroll to zoom, drag to pan, double-click to fit.`} onWheel={handlePreviewWheel} onDoubleClick={fitPreview} onPointerDown={startPreviewPointer} onPointerMove={movePreviewPointer} onPointerUp={endPreviewPointer} onPointerCancel={endPreviewPointer} />
          <canvas ref={playbackCanvas} className="playback-canvas" width="1100" height="700" aria-hidden="true" />
          <div className="preview-status"><span>{previewMode}</span><span>{Math.round(zoom * 100)}%</span><span>{settings.outputWidth.toFixed(1)} × {settings.outputHeight.toFixed(1)} {settings.units}</span>{previewMode === 'toolpath' && currentTimings?.previewSegments ? <span>{currentTimings.previewSegments.toLocaleString()} segments</span> : null}</div>
          <div className="preview-hint">{editPlacement ? 'Drag to move · Drag corners to resize · Scroll to zoom' : previewMode === 'toolpath' ? 'Scroll to zoom · Drag to pan · Double-click to fit' : 'Preview only · Scroll to zoom · Drag to pan · Double-click to fit'}</div>
        </div> : <div className="preview-empty"><b>Toolpath preview</b><span>Upload an image to generate a preview.</span></div>}</ImageInput></div>
        <div className="playback">{previewMode === 'toolpath' && <div className="preview-overlays" role="group" aria-label="Toolpath overlays"><button type="button" className={showTravel ? 'selected' : ''} aria-pressed={showTravel} title="Show or hide tool-inactive travel moves" onClick={() => setShowTravel((value) => !value)}>Travel</button><button type="button" className={showEndpoints ? 'selected' : ''} aria-pressed={showEndpoints} title="Show or hide active-path start and end markers" onClick={() => setShowEndpoints((value) => !value)}>Start / end</button></div>}<div className="playback-controls"><button aria-label={playing ? 'Pause toolpath playback' : 'Play toolpath playback'} disabled={!currentPreviewMoves || previewMode !== 'toolpath'} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</button><input aria-label="Toolpath playback" disabled={previewMode !== 'toolpath'} type="range" min="0" max="1" step=".001" value={playbackProgress} onChange={(event) => setPlaybackProgress(Number(event.target.value))} /><button aria-label="Restart toolpath playback" disabled={!currentPreviewMoves || previewMode !== 'toolpath'} onClick={() => setPlaybackProgress(0)}><RotateCcw /></button><span>{Math.round(playbackProgress * 100)}%</span></div></div>
      </section>
      <aside className="code"><div className="code-head"><h2>G-code inspector</h2><button disabled={!currentJobResult || placementPending || review.level === 'blocking' || gcodeState === 'generating'} title={review.level === 'blocking' ? 'Resolve blocking export issues before copying' : undefined} onClick={() => requestGcode('copy')}><Copy size={15} /> {gcodeState === 'generating' ? 'Generating…' : 'Copy'}</button></div>{currentGcode ? <><input placeholder="Search G-code" value={search} onChange={(event) => setSearch(event.target.value)} /><p className="code-limit">{search ? 'Showing 200 lines from the match' : `Showing first ${Math.min(2_000, currentGcode.lines).toLocaleString()} of ${currentGcode.lines.toLocaleString()} lines`}</p><pre>{gcodeLines?.lines.map((line, index) => <div key={index} className={search && line.toLowerCase().includes(search.toLowerCase()) ? 'match' : ''}><i>{String((gcodeLines?.start ?? 1) + index).padStart(4, '0')}</i>{line}</div>)}</pre></> : <div className="gcode-empty"><p>{placementPending ? 'Updating image placement…' : currentJobResult ? 'G-code is ready to generate on demand.' : 'Import an image to prepare G-code.'}</p><button disabled={!currentJobResult || placementPending || gcodeState === 'generating'} onClick={() => requestGcode('inspect')}>{gcodeState === 'generating' ? 'Generating G-code…' : 'Open G-code inspector'}</button></div>}</aside>
    </main>
    {reviewOpen && <div className="review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}><section className="export-review" role="dialog" aria-modal="true" aria-labelledby="export-review-title"><div className="review-head"><div><small>PRE-EXPORT VALIDATION</small><h2 id="export-review-title">Review G-code output</h2></div><button ref={reviewCloseButton} type="button" aria-label="Back to editing" onClick={() => setReviewOpen(false)}>×</button></div><div className={`review-status ${review.level}`}><b>{review.level === 'ready' ? 'Ready — fits within machine work area' : review.level === 'warning' ? 'Warning — inspect before exporting' : 'Blocking issue — return to edit'}</b></div><div className="review-grid"><section><h3>Machine</h3><p><b>Profile:</b> {profile.name}<br /><b>Work area:</b> {settings.workWidth} × {settings.workHeight} {settings.units}<br /><b>Origin:</b> {settings.origin.replace('-', ' ')}<br /><b>X inversion:</b> {settings.invertX ? 'On' : 'Off'} · <b>Y inversion:</b> {settings.invertY ? 'On' : 'Off'}</p>{profile.kind === 'cnc' ? <p><b>Safe Z:</b> {settings.safeZ} · <b>Working Z:</b> {settings.workZ}<br /><b>Passes:</b> {settings.passes} · <b>Feed / travel:</b> {settings.feed} / {settings.travel}</p> : <p><b>Tool on:</b> {profile.toolOn.trim() || 'Not configured'}<br /><b>Tool off:</b> {profile.toolOff.trim() || 'Not configured'}</p>}</section><section><h3>Image placement</h3><p><b>Output size:</b> {settings.outputWidth.toFixed(1)} × {settings.outputHeight.toFixed(1)} {settings.units}<br /><b>Position:</b> X {settings.offsetX.toFixed(1)}, Y {settings.offsetY.toFixed(1)} {settings.units}<br /><b>Rotation:</b> {settings.rotationDeg}° · <b>Invert image:</b> {settings.invert ? 'On' : 'Off'}</p><h3>Toolpath</h3><p><b>Conversion:</b> {mode}<br /><b>Detail:</b> {settings.toolpathDetail.toFixed(2)} mm<br /><b>Movements:</b> {currentStats?.movementCount.toLocaleString() ?? '—'} · <b>Paths:</b> {currentTimings?.pathCount.toLocaleString() ?? '—'}</p></section><section><h3>Estimated output</h3><p><b>Drawing:</b> {currentStats?.work.toFixed(1) ?? '—'} {settings.units}<br /><b>Travel:</b> {currentStats?.travel.toFixed(1) ?? '—'} {settings.units}<br /><b>Runtime:</b> {currentStats ? `≈ ${currentStats.time.toFixed(1)} min` : '—'}<br /><b>G-code size:</b> {currentGcode ? `${(currentGcode.characters / 1_000_000).toFixed(2)} MB` : 'Generated on confirmation'}</p></section></div>{review.messages.length > 0 && <div className="review-messages">{review.messages.map((message) => <p key={message}><AlertTriangle size={14} />{message}</p>)}</div>}<div className="review-actions"><button type="button" onClick={() => setReviewOpen(false)}>Back to edit</button><button type="button" className="export-confirm" disabled={review.level === 'blocking' || gcodeState === 'generating'} onClick={() => { const approvedKey = reviewKey; setReviewOpen(false); requestGcode('download', approvedKey); }}>{gcodeState === 'generating' ? 'Generating G-code…' : review.level === 'warning' ? 'Export anyway' : 'Export G-code'}</button></div></section></div>}
    <footer>{complexity?.level === 'extreme' && approvedExtremeKey !== complexityKey && <div className="warning complexity-warning"><AlertTriangle size={15} />This setting estimates {complexity.movements.toLocaleString()} movements and may use significant memory. Recommended: ≥ {complexity.recommendedDetail.toFixed(2)} mm.<button onClick={() => setApprovedExtremeKey(complexityKey)}>Process anyway</button></div>}{workerError && <div className="warning"><AlertTriangle size={15} />{workerError}</div>}{currentJobResult?.warnings.map((warning) => <div className="warning" key={warning}><AlertTriangle size={15} />{warning}</div>)}{currentStats && currentJobResult && <div className="stats"><span>{currentStats.movementCount} movements</span><span>{currentStats.working} working / {currentStats.travels} travel moves</span><span>{currentStats.work.toFixed(1)} {settings.units} work</span><span>{currentStats.travel.toFixed(1)} {settings.units} travel</span><span>≈ {currentStats.time.toFixed(1)} min</span><span>X {currentStats.bounds?.minX.toFixed(1)}–{currentStats.bounds?.maxX.toFixed(1)} · Y {currentStats.bounds?.minY.toFixed(1)}–{currentStats.bounds?.maxY.toFixed(1)}</span></div>}<div className="safety"><AlertTriangle size={14} /> Always inspect G-code and verify your machine configuration. Previewing does not guarantee safe operation.<span className="footer-license">© 2026 William Xu · <a href="https://github.com/wxu2206/image-to-gcode/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a> · <a href="https://github.com/wxu2206/image-to-gcode" target="_blank" rel="noopener noreferrer">GitHub</a></span></div></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
