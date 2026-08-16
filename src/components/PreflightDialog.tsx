import type { KeyboardEvent, RefObject } from 'react';
import { AlertTriangle, CheckCircle2, CircleX } from 'lucide-react';
import type { PreflightCheck, PreflightExportAction, PreflightResult } from '../core/exportReview';
import type { ConversionMode, MachineProfile, Point, Settings } from '../core/types';
import { getPostProcessor } from '../postprocessors/registry';
import { formatEstimatedDuration } from '../utils/duration';

export type { PreflightExportAction } from '../core/exportReview';

type Props = {
  result: PreflightResult;
  settings: Settings;
  profile: MachineProfile;
  mode: ConversionMode;
  action: PreflightExportAction;
  generating: boolean;
  gcodeMegabytes: number | null;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onConfirm: () => void;
};

const severityLabel: Record<PreflightCheck['severity'], string> = {
  pass: 'Passed',
  warning: 'Warning',
  blocking: 'Blocking',
};

function CheckIcon({ severity }: { severity: PreflightCheck['severity'] }) {
  if (severity === 'pass') return <CheckCircle2 aria-hidden="true" size={15} />;
  if (severity === 'warning') return <AlertTriangle aria-hidden="true" size={15} />;
  return <CircleX aria-hidden="true" size={15} />;
}

function pointText(point: Point | null, settings: Settings): string {
  if (!point) return '—';
  const precision = Number.isInteger(settings.precision) ? Math.max(0, Math.min(6, settings.precision)) : 3;
  const z = point.z === undefined ? '' : `, Z ${point.z.toFixed(precision)}`;
  return `X ${point.x.toFixed(precision)}, Y ${point.y.toFixed(precision)}${z}`;
}

export function PreflightDialog({
  result,
  settings,
  profile,
  mode,
  action,
  generating,
  gcodeMegabytes,
  closeButtonRef,
  onClose,
  onConfirm,
}: Props) {
  const processor = getPostProcessor(profile.postProcessorId);
  const capabilities = processor?.capabilities(profile);
  const trapKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const summary = result.summary;
  const statusText = result.status === 'passed'
    ? 'Preflight passed — no known configuration issues detected'
    : result.status === 'warnings'
      ? `${result.warningCount} preflight warning${result.warningCount === 1 ? '' : 's'} — review required`
      : `${result.blockingCount} blocking preflight issue${result.blockingCount === 1 ? '' : 's'} — export unavailable`;
  const actionLabel = action === 'copy' ? 'Copy G-code' : 'Download G-code';

  return <div className="review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="export-review" role="dialog" aria-modal="true" aria-labelledby="preflight-title" aria-describedby="preflight-disclaimer" onKeyDown={trapKeyboard}>
      <div className="review-head"><div><small>CANONICAL EXPORT VALIDATION</small><h2 id="preflight-title">Preflight</h2></div><button ref={closeButtonRef} type="button" aria-label="Back to editing" onClick={onClose}>×</button></div>
      <div className={`review-status ${result.status}`} role={result.status === 'passed' ? 'status' : 'alert'}><b>{statusText}</b></div>
      <ul className="preflight-checks" aria-label="Preflight checks">
        {result.checks.map((item) => <li key={item.id} className={item.severity}>
          <CheckIcon severity={item.severity} />
          <div><span className="check-severity">{severityLabel[item.severity]}:</span> <b>{item.title}</b>{item.message && <p>{item.message}</p>}</div>
        </li>)}
      </ul>
      <div className="review-grid">
        <section><h3>Machine</h3><p><b>Profile:</b> {profile.name}<br /><b>Post-processor:</b> {processor?.name ?? 'Unavailable'}<br /><b>Tool model:</b> {capabilities?.toolStateModel ?? 'Unknown'} · <b>Z motion:</b> {capabilities?.supportsZ ? 'Yes' : 'No'}<br /><b>Work area:</b> {settings.workWidth} × {settings.workHeight} {settings.units}<br /><b>Origin:</b> {settings.origin.replace('-', ' ')}<br /><b>Feed / travel:</b> {settings.feed} / {settings.travel} {settings.units}/min</p>{capabilities?.requiresSafeZ && <p><b>Safe Z:</b> {settings.safeZ} · <b>Working Z:</b> {settings.workZ}<br /><b>Maximum depth:</b> {settings.maxDepth} · <b>Passes:</b> {settings.passes}</p>}</section>
        <section><h3>Canonical job</h3><p><b>Conversion:</b> {mode}<br /><b>Movements:</b> {summary?.movementCount.toLocaleString() ?? '—'} · <b>Paths:</b> {summary?.pathCount.toLocaleString() ?? '—'}<br /><b>Start:</b> {pointText(summary?.start ?? null, settings)}<br /><b>End:</b> {pointText(summary?.end ?? null, settings)}</p></section>
        <section><h3>Estimated output</h3><p><b>Drawing:</b> {summary?.drawingDistance.toFixed(1) ?? '—'} {settings.units}<br /><b>Travel:</b> {summary?.travelDistance.toFixed(1) ?? '—'} {settings.units}<br /><b>Travel efficiency:</b> {summary ? `${Math.round(summary.travelEfficiency * 100)}%` : '—'}<br /><b title="Approximate. Controller acceleration, dwell, and custom commands may change real runtime.">Estimated time:</b> {summary ? formatEstimatedDuration(summary.estimatedMinutes) : '—'}<br /><b>G-code size:</b> {gcodeMegabytes === null ? 'Generated on confirmation' : `${gcodeMegabytes.toFixed(2)} MB`}</p></section>
      </div>
      <p className="preflight-runtime-note">Runtime is approximate; controller acceleration, dwell, and custom commands may change actual time.</p>
      <p className="preflight-disclaimer" id="preflight-disclaimer">Preflight checks common generator and configuration issues. It does not guarantee safe machine operation.</p>
      <div className="review-actions"><button type="button" onClick={onClose}>Back to edit</button><button type="button" className="export-confirm" disabled={result.status === 'blocked' || generating} onClick={onConfirm}>{generating ? 'Generating G-code…' : result.status === 'warnings' ? `Accept warnings & ${actionLabel}` : actionLabel}</button></div>
    </section>
  </div>;
}
