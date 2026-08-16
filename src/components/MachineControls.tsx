import type { ChangeEvent } from 'react';
import type { MachineProfile, PostProcessorId, Settings } from '../core/types';
import { getPostProcessor, kindForProcessor, listPostProcessors, requirePostProcessor } from '../postprocessors/registry';

type Props = {
  settings: Settings;
  profile: MachineProfile;
  rasterSource: boolean;
  onSetting: (key: keyof Settings, value: unknown) => void;
  onUnits: (units: Settings['units']) => void;
  onProfile: (values: Partial<MachineProfile>) => void;
};

const number = (event: ChangeEvent<HTMLInputElement>) => Number(event.target.value);

export function MachineControls({ settings, profile, rasterSource, onSetting, onUnits, onProfile }: Props) {
  const processor = getPostProcessor(profile.postProcessorId) ?? requirePostProcessor('generic');
  const capabilities = processor.capabilities(profile);
  const selectProcessor = (postProcessorId: PostProcessorId) => onProfile({
    postProcessorId,
    kind: kindForProcessor(postProcessorId, profile.kind),
  });

  return <>
    <label>Controller / output
      <select aria-label="Controller / output" value={profile.postProcessorId} onChange={(event) => selectProcessor(event.target.value as PostProcessorId)}>
        {!getPostProcessor(profile.postProcessorId) && <option value={profile.postProcessorId}>Unavailable processor — select another</option>}
        {listPostProcessors().map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <small className="field-help">Controls how canonical movements are translated into controller-specific G-code.</small>
    </label>

    <h3>Machine</h3>
    <div className="grid">
      <label>Units<select value={settings.units} onChange={(event) => onUnits(event.target.value as Settings['units'])}><option value="mm">Millimeters</option><option value="in">Inches</option></select></label>
      <label>Work area width<input type="number" value={settings.workWidth} step="1" onChange={(event) => onSetting('workWidth', number(event))} /></label>
      <label>Work area height<input type="number" value={settings.workHeight} step="1" onChange={(event) => onSetting('workHeight', number(event))} /></label>
      <label>Drawing speed<input type="number" value={settings.feed} step="1" onChange={(event) => onSetting('feed', number(event))} /></label>
      <label>Travel speed<input type="number" value={settings.travel} step="1" onChange={(event) => onSetting('travel', number(event))} /></label>
      {capabilities.supportsZ && <label>Working depth<input type="number" value={settings.workZ} step="0.1" onChange={(event) => onSetting('workZ', number(event))} /></label>}
    </div>
    {rasterSource && <label title="Removes isolated tiny marks. Strong cleanup can remove extremely fine intentional features; dither patterns are preserved.">Noise cleanup<select value={settings.noiseCleanup} onChange={(event) => onSetting('noiseCleanup', event.target.value as Settings['noiseCleanup'])}><option value="off">Off</option><option value="light">Light</option><option value="normal">Normal</option><option value="strong">Strong</option></select></label>}

    <details className="advanced-settings">
      <summary>Advanced settings</summary>
      <small>Advanced settings can change machine behaviour. Review G-code before running it.</small>
      <h4>Coordinates</h4>
      <div className="grid">
        <label>Origin<select value={settings.origin} onChange={(event) => onSetting('origin', event.target.value as Settings['origin'])}><option value="bottom-left">Bottom left</option><option value="top-left">Top left</option><option value="center">Center</option></select></label>
        <label>Coordinate precision<input type="number" min="0" max="8" step="1" value={settings.precision} onChange={(event) => onSetting('precision', number(event))} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={settings.invertX} onChange={(event) => onSetting('invertX', event.target.checked)} /> Invert X axis</label>
      <label className="check"><input type="checkbox" checked={settings.invertY} onChange={(event) => onSetting('invertY', event.target.checked)} /> Invert Y axis</label>

      <h4>Toolpath</h4>
      <div className="grid">
        <label>Line spacing<input type="number" min="0" step="0.1" value={settings.lineSpacing} onChange={(event) => onSetting('lineSpacing', number(event))} /></label>
        {capabilities.requiresSafeZ && <label>Pass count<input type="number" min="1" step="1" value={settings.passes} onChange={(event) => onSetting('passes', number(event))} /></label>}
        {capabilities.requiresSafeZ && <label>Safe Z<input type="number" min="0" step="0.1" value={settings.safeZ} onChange={(event) => onSetting('safeZ', number(event))} /></label>}
        {capabilities.requiresSafeZ && <label>Maximum depth<input type="number" max="0" step="0.1" value={settings.maxDepth} onChange={(event) => onSetting('maxDepth', number(event))} /></label>}
        {capabilities.requiresSafeZ && <label>Pass depth<input type="number" min="0" step="0.1" value={profile.passDepth} onChange={(event) => onProfile({ passDepth: number(event) })} /></label>}
      </div>
      {rasterSource && <label className="check"><input type="checkbox" checked={settings.serpentine} onChange={(event) => onSetting('serpentine', event.target.checked)} /> Serpentine scan</label>}

      {rasterSource && <><h4>Image processing</h4><label>Filter<select value={settings.filter} onChange={(event) => onSetting('filter', event.target.value as Settings['filter'])}><option value="grayscale">Grayscale</option><option value="threshold">Threshold</option><option value="edge">Edge detection</option><option value="dither">Dithering</option></select></label><div className="grid"><label>Threshold<input type="number" min="0" max="255" value={settings.threshold} onChange={(event) => onSetting('threshold', number(event))} /></label><label>Simplification<input type="number" min="0" value={settings.simplify} onChange={(event) => onSetting('simplify', number(event))} /></label><label>Brightness<input type="number" min="-255" max="255" value={settings.brightness} onChange={(event) => onSetting('brightness', number(event))} /></label><label>Contrast<input type="number" min="-100" max="100" value={settings.contrast} onChange={(event) => onSetting('contrast', number(event))} /></label></div><label className="check"><input type="checkbox" checked={settings.invert} onChange={(event) => onSetting('invert', event.target.checked)} /> Invert image</label></>}

      <h4>Machine commands</h4>
      <label>Profile name<input value={profile.name} maxLength={128} onChange={(event) => onProfile({ name: event.target.value })} /></label>
      <label>Startup<textarea value={profile.header} maxLength={16_384} onChange={(event) => onProfile({ header: event.target.value })} /></label>
      <label>{capabilities.toolStateModel === 'pen' ? 'Pen down' : capabilities.toolStateModel === 'laser' ? 'Laser on' : 'Tool on'}<textarea value={profile.toolOn} maxLength={16_384} onChange={(event) => onProfile({ toolOn: event.target.value })} /></label>
      <label>{capabilities.toolStateModel === 'pen' ? 'Pen up' : capabilities.toolStateModel === 'laser' ? 'Laser off' : 'Tool off'}<textarea value={profile.toolOff} maxLength={16_384} onChange={(event) => onProfile({ toolOff: event.target.value })} /></label>
      <label>Shutdown<textarea value={profile.footer} maxLength={16_384} onChange={(event) => onProfile({ footer: event.target.value })} /></label>
      <small>Custom commands are not fully simulated by preflight.</small>
    </details>
  </>;
}
