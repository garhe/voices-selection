import { useEffect, useRef, useState } from 'react';
import { evaluationName, voiceGenders, type Job, type VoiceLabel } from '../shared/domain';
import { canManageTest, defaultTestFilters, queryTests, testNameMetadata, TEST_PAGE_SIZE, type BulkTestAction, type TestFilters, type TestHistory } from '../shared/history';
import { TestActions, type ReportKind } from './TestActions';
import { DatePicker } from './DatePicker';

export type { ReportKind } from './TestActions';
export function TestLibrary({ entries, busy, selectedIds, onSelectionChange, onBulkAction, onOpen, onEdit, onDelete, onDownload, onRegenerate, onRefresh }: {
  entries: TestHistory[]; busy: boolean;
  selectedIds: string[]; onSelectionChange: (ids: string[]) => void;
  onBulkAction: (action: BulkTestAction, entries: TestHistory[]) => void;
  onOpen: (entry: TestHistory) => void; onEdit: (entry: TestHistory) => void;
  onDelete: (entry: TestHistory) => void; onDownload: (entry: TestHistory, kind: ReportKind) => void;
  onRegenerate: (entry: TestHistory) => void; onRefresh: () => void;
}) {
  const [filters, setFilters] = useState<TestFilters>({ ...defaultTestFilters });
  const [page, setPage] = useState(1);
  const [dateReset, setDateReset] = useState(0);
  const results = queryTests(entries, filters, page);
  const selectionControl = useRef<HTMLInputElement>(null);
  const selected = entries.filter(entry => selectedIds.includes(entry.id) && canManageTest(entry));
  const selectedSet = new Set(selected.map(entry => entry.id));
  const eligibleOnPage = results.entries.filter(canManageTest);
  const checkedOnPage = eligibleOnPage.filter(entry => selectedSet.has(entry.id)).length;
  useEffect(() => {
    if (selectionControl.current) selectionControl.current.indeterminate = checkedOnPage > 0 && checkedOnPage < eligibleOnPage.length;
  }, [checkedOnPage, eligibleOnPage.length]);
  function select(ids: string[], checked: boolean) {
    const next = new Set(selectedSet);
    for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    onSelectionChange([...next]);
  }
  const languages = [...new Map(entries.flatMap(entry => entry.languages).map(language => [language.toLowerCase(), language])).values()].sort();
  function update<K extends keyof TestFilters>(key: K, value: TestFilters[K]) {
    setFilters(previous => ({ ...previous, [key]: value })); setPage(1);
  }
  const dateError = filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo;
  return <>
    <div className="page-title test-library-title"><div><h1>Test Reports</h1>
      <p className="muted">Open a test for details. Use Actions to edit, download or rerun reports.</p></div>
      <button className="secondary" disabled={busy} onClick={onRefresh}>Refresh tests</button>
    </div>
    <section className="card test-library" aria-label="Saved tests">
      <div className="test-filters">
        <label className="test-search">Search tests<input type="search" placeholder="Test name, voice, language or ID" value={filters.search} onChange={event => update('search', event.target.value)} /></label>
        <label>Language<select value={filters.language} onChange={event => update('language', event.target.value)}>
          <option value="">All languages</option>{languages.map(language => <option key={language}>{language}</option>)}
        </select></label>
        <label>Gender<select value={filters.gender} onChange={event => update('gender', event.target.value)}>
          <option value="">All genders</option>{voiceGenders.map(gender => <option key={gender}>{gender}</option>)}
        </select></label>
        <DatePicker key={`from-${dateReset}`} label="From date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={value => update('dateFrom', value)} />
        <DatePicker key={`to-${dateReset}`} label="To date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={value => update('dateTo', value)} />
        <label>Sort by<select value={filters.sort} onChange={event => update('sort', event.target.value as TestFilters['sort'])}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="name-asc">Test name A-Z</option><option value="name-desc">Test name Z-A</option>
          <option value="score-desc">Best score: high to low</option><option value="score-asc">Best score: low to high</option>
        </select></label>
      </div>
      {dateError && <p className="error-text" role="alert">From date must be on or before To date.</p>}
      <div className="test-list-meta"><p className="test-count" role="status">{results.total} of {entries.length} tests{results.total > 0 && ` · ${(results.page - 1) * TEST_PAGE_SIZE + 1}-${Math.min(results.page * TEST_PAGE_SIZE, results.total)} shown`}</p>
        {!!selected.length && <div className="test-bulk-actions" aria-label="Selected test actions">
          <span role="status" title="Selection is kept across pages and filters.">{selected.length} selected</span>
          <button className="text-button danger" disabled={busy} onClick={() => onBulkAction('delete', selected)}>Delete selected</button>
          <button className="text-button" disabled={busy} onClick={() => onBulkAction('redo', selected)}>Redo selected</button>
          <button className="text-button" disabled={busy} onClick={() => onSelectionChange([])}>Clear selection</button>
        </div>}
        <button className="text-button" disabled={!filters.search && !filters.language && !filters.gender && !filters.dateFrom && !filters.dateTo && filters.sort === 'newest'} onClick={() => { setFilters({ ...defaultTestFilters }); setDateReset(previous => previous + 1); setPage(1); }}>Clear filters</button>
      </div>
      <div className="table-scroll test-table-scroll" tabIndex={0} aria-label="Saved test list">
        <table className="test-table">
          <caption className="sr-only">Saved evaluations, up to 30 tests per page</caption>
          <thead><tr><th scope="col" className="test-select"><input ref={selectionControl} type="checkbox" aria-label="Select all eligible tests on this page"
            disabled={busy || !eligibleOnPage.length} checked={eligibleOnPage.length > 0 && checkedOnPage === eligibleOnPage.length}
            onChange={event => select(eligibleOnPage.map(entry => entry.id), event.target.checked)} /></th>
            <th scope="col">Test name</th><th scope="col">Test time</th><th scope="col">Best voice</th><th scope="col">Best score</th><th scope="col">Language</th><th scope="col">Gender</th><th scope="col">Actions</th></tr></thead>
          <tbody>{results.entries.map(entry => <tr key={entry.id}>
            <td className="test-select"><input type="checkbox" aria-label={`Select test ${entry.name}`} checked={selectedSet.has(entry.id)}
              disabled={busy || !canManageTest(entry)} title={canManageTest(entry) ? 'Select for bulk actions' : 'Running and queued tests cannot be deleted or redone'}
              onChange={event => select([entry.id], event.target.checked)} /></td>
            <td data-label="Test name"><button className="test-name" title={entry.name} disabled={busy} onClick={() => onOpen(entry)}>{entry.name}</button>
              <div className="test-row-meta"><span title={entry.stage === 'audition' ? 'Voice Selection' : 'TTS evaluation'}>{entry.clips} excerpts</span>
                <span className={`status-badge ${entry.status}`}>{entry.status}</span></div></td>
            <td data-label="Test time"><time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>{new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              <small>{new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></time></td>
            <td data-label="Best voice">{entry.bestScore === null ? <span>Not assessed</span> : <>
              {entry.bestVoices.slice(0, 1).map(voice => <div className="test-best-voice" key={JSON.stringify(voice)}><strong title={voice.voice}>{voice.voice}</strong><small>{voice.role}</small></div>)}
              {entry.bestVoices.length > 1 && <button className="test-ties" title={entry.bestVoices.map(voice => `${voice.voice} / ${voice.role}`).join(', ')} disabled={busy} onClick={() => onOpen(entry)}>+{entry.bestVoices.length - 1} tied</button>}
            </>}</td>
            <td data-label="Best score">{entry.bestScore === null ? <span>Not assessed</span> : <>
              <strong className="test-score">{entry.bestScore.toFixed(2)}</strong><span className="test-score-scale"> / 5</span>
              {entry.status === 'running' && <small>Provisional</small>}
            </>}</td>
            <td data-label="Language">{entry.languages.join(', ') || 'Not specified'}</td>
            <td data-label="Gender">{entry.genders.join(', ') || 'Unspecified'}</td>
            <td data-label="Actions"><TestActions entry={entry} busy={busy} onEdit={onEdit} onDelete={onDelete}
              onRegenerate={onRegenerate} onDownload={onDownload} /></td>
          </tr>)}
            {!results.entries.length && <tr><td colSpan={8}><h3>{entries.length ? 'No matching tests' : 'No saved tests yet'}</h3>
              <p>{entries.length ? 'Change or clear the filters to see more tests.' : 'Create an evaluation in Evaluation setup. Its results will appear here.'}</p></td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="test-pagination" aria-label="Test pages">
        <button className="secondary" disabled={results.page === 1} onClick={() => setPage(results.page - 1)}>Previous page</button>
        <label>Page<select aria-label="Test page" value={results.page} onChange={event => setPage(Number(event.target.value))}>
          {Array.from({ length: results.pages }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select></label><span>of {results.pages} · 30 per page</span>
        <button className="secondary" disabled={results.page === results.pages} onClick={() => setPage(results.page + 1)}>Next page</button>
      </nav>
    </section>
  </>;
}

export function TestMetadataEditor({ job, busy, onSave, onCancel }: {
  job: Job; busy: boolean; onSave: (name: string, labels: VoiceLabel[]) => void; onCancel: () => void;
}) {
  const editor = useRef<HTMLElement>(null);
  useEffect(() => {
    editor.current?.scrollIntoView({ block: 'start' });
    editor.current?.querySelector('input')?.focus({ preventScroll: true });
  }, []);
  const [name, setName] = useState(evaluationName(job));
  const metadata = testNameMetadata(name);
  return <section ref={editor} className="card test-metadata" role="region" aria-labelledby="edit-test-title">
    <h2 id="edit-test-title">Edit test details</h2>
    <p className="hint">Language and gender in the test list come from this name, for example "en-GB Female VTS". Rename the test to update them. Audio, scores, test time, saved voice labels and assessments stay unchanged. To change evaluation inputs, open the test and use Edit inputs.</p>
    <form onSubmit={event => { event.preventDefault(); onSave(name, job.voiceLabels ?? []); }}>
      <label>Test name<input required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <div className="name-metadata" aria-live="polite"><p><strong>Language from name:</strong> {metadata.languages.join(', ') || 'Not specified'}</p>
        <p><strong>Gender from name:</strong> {metadata.genders.join(', ')}</p></div>
      <div className="button-row"><button className="primary" type="submit" disabled={busy}>Save test details</button>
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel edit</button></div>
    </form>
  </section>;
}
