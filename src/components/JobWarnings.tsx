export function JobWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  const outsideSummary = warnings.find((warning) => /^\d+ paths outside work area/.test(warning))?.match(/^\d+ paths outside work area/)?.[0];
  return <div className="job-warnings">
    <div role="status">{warnings.length} job warning{warnings.length === 1 ? '' : 's'}{outsideSummary ? `; ${outsideSummary}` : ''}. Review details before export.</div>
    <details><summary>Warning details</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>
  </div>;
}
