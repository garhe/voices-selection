import { useState } from 'react';
import { parseSortingPaths, type SortingPreview, type SortingRequest, type SortingResults } from '../shared/sorting';

export function FolderSorter({ busy, onAction, onPreview, onApply }: {
  busy: boolean;
  onAction: (label: string, run: () => Promise<void>) => Promise<void>;
  onPreview: (request: SortingRequest) => Promise<SortingPreview>;
  onApply: (token: string) => Promise<SortingResults>;
}) {
  const [paths, setPaths] = useState('');
  const [mode, setMode] = useState<SortingRequest['mode']>('replace');
  const [outputDirectory, setOutputDirectory] = useState('');
  const [nameFormat, setNameFormat] = useState('{name}');
  const [preview, setPreview] = useState<SortingPreview>();
  const [results, setResults] = useState<SortingResults>();
  const selectedPaths = parseSortingPaths(paths);
  const ready = preview?.entries.filter(entry => entry.plan) ?? [];
  function invalidate() {
    setPreview(undefined); setResults(undefined);
  }
  function applyPreview() {
    if (!preview) return;
    const token = preview.token;
    const replacing = preview.mode === 'replace';
    setPreview(undefined);
    void onAction(replacing ? 'Replacing voice collections' : 'Copying sorted voice collections', async () => setResults(await onApply(token)));
  }
  return <section className="folder-sorting" aria-label="Folder sorting">
    <div className="page-title"><div><h1>Folder sorting</h1><p className="muted">Sort local voice collections without running commands.</p></div></div>
    <div className="card sorting-form">
      <label>Collection directories (one absolute path per line)<textarea rows={5} value={paths} disabled={busy}
        placeholder={'"D:\\Work Folder\\11labs_cs-CZ_M"\n"D:\\Work Folder\\11labs_da-DK_F"'}
        onChange={event => { setPaths(event.target.value); invalidate(); }} /></label>
      <p className="hint">{selectedPaths.length} {selectedPaths.length === 1 ? 'directory' : 'directories'} entered. Paste one directory per line, with or without surrounding double quotes. Spaces in paths are preserved. Windows local server only. There is no folder-count limit. Enter individual collection folders, not their common parent. TTS/NonTTS grouping folders are removed; WAV files are flattened into voice folders. Duplicate filenames are renamed. Files are not uploaded or sent to Azure.</p>
      <div className="field-row">
        <label>Original folders<select value={mode} disabled={busy} onChange={event => {
          const nextMode = event.target.value === 'replace' ? 'replace' : 'keep';
          setMode(nextMode); setOutputDirectory(''); setNameFormat(nextMode === 'replace' ? '{name}' : '{name}_sorted'); invalidate();
        }}>
          <option value="keep">Keep originals — create sorted copies</option>
          <option value="replace">Replace originals — permanently remove original contents</option>
        </select></label>
        <label>Output parent directory (optional)<input value={outputDirectory} disabled={busy} placeholder="Blank = each original folder's parent"
          onChange={event => { setOutputDirectory(event.target.value); invalidate(); }} /></label>
        <label>Output folder name format<input value={nameFormat} disabled={busy} placeholder={mode === 'replace' ? '{name}' : '{name}_sorted'}
          onChange={event => { setNameFormat(event.target.value); invalidate(); }} /></label>
      </div>
      <p className="hint">Output options apply to both modes. Changing Original folders resets the output options: replacement keeps the original name and location; copies use {'{name}_sorted'}. You can then choose a different output parent or name. The output parent must already exist. Use {'{name}'} for the original collection name and {'{index}'} for its position in the list. Existing output folders are never overwritten except for the original folder during in-place replacement.</p>
      {mode === 'replace' ? <p className="error-text"><strong>Replacing originals is permanent.</strong> Sorted WAV copies are verified at the previewed output path before original contents are removed, including non-WAV files and empty folders. Keep a backup before continuing.</p>
        : <p className="hint">Original folders and all their contents remain unchanged. Non-WAV files and empty folders are omitted only from the sorted copies.</p>}
      <button className="secondary" disabled={busy || !selectedPaths.length || !nameFormat.trim()} onClick={() => void onAction('Previewing folder sorting', async () => {
        setPreview(undefined); setResults(undefined);
        setPreview(await onPreview({ paths: selectedPaths, mode, outputDirectory: outputDirectory.trim().replace(/^"(.*)"$/, '$1'), nameFormat }));
      })}>Preview sorting</button>
    </div>
    {preview && <div className="card">
      <h2>Sorting preview</h2><p className="hint">No files have changed. Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}. Up to 100 planned files are shown per directory.</p>
      {preview.entries.map(entry => <article key={entry.source} className="sorting-entry">
        <h3>{entry.source}</h3>
        {entry.output && <p>Output: {entry.output}</p>}
        {entry.error && <p className="error-text" role="alert">{entry.error}</p>}
        {entry.plan && <>
          <p>{entry.plan.wavFiles} WAV files · {entry.plan.voiceFolders} voices · {entry.plan.renamedFiles} duplicates renamed · <strong>{entry.plan.omittedFiles} non-WAV files {preview.mode === 'replace' ? 'will be deleted' : 'omitted from copy; originals kept'}</strong></p>
          <details><summary>Show planned output</summary><ul className="sorting-mappings">{entry.plan.mappings.map(mapping => <li key={mapping.destination}><span>{mapping.source}</span><strong>{mapping.destination}</strong></li>)}</ul></details>
        </>}
      </article>)}
      <button className={`secondary${preview.mode === 'replace' ? ' danger' : ''}`} disabled={busy || !ready.length || Date.parse(preview.expiresAt) <= Date.now()} onClick={applyPreview}>
        {preview.mode === 'replace' ? `Replace ${ready.length} original collection${ready.length === 1 ? '' : 's'}` : `Create ${ready.length} sorted ${ready.length === 1 ? 'copy' : 'copies'}`}
      </button>
    </div>}
    {results && <div className="card" role="region" aria-label="Folder sorting results"><h2>Sorting results</h2>
      <p role="status">{results.entries.filter(entry => entry.output).length} {results.mode === 'replace' ? 'replaced' : 'copied; originals kept'} · {results.entries.filter(entry => entry.error).length} failed</p>
      {results.entries.map(entry => <article key={entry.source} className="sorting-entry"><h3>{entry.source}</h3>
        {entry.output && <p>Sorted collection saved at {entry.output}</p>}
        {entry.error && <p className="error-text" role="alert">{entry.error}</p>}
      </article>)}
    </div>}
  </section>;
}
