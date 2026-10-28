import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRetryUnassessedTest, testHistory, testStatusLabel, testNameMetadata, queryTests, defaultTestFilters, testMetadataSchema, testTableCsv, TEST_PAGE_SIZES, TEST_STATUS_FILTERS, type TestHistory } from '../shared/history.js';
import { csvCell } from '../shared/csv.js';
import { assessment, clip, job } from './fixtures.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestLibrary } from '../src/TestLibrary.js';
import { ConfirmationDialog } from '../src/ConfirmationDialog.js';
import { TestActions } from '../src/TestActions.js';
import { readFileSync } from 'node:fs';
import { DatePicker, calendarDateKey, calendarDays, parseCalendarDate, shiftCalendarMonth } from '../src/DatePicker.js';
import { ThemePicker } from '../src/ThemePicker.js';
import { App } from '../src/App.js';
import { RubricEditor } from '../src/RubricEditor.js';
import { DEFAULT_RUBRIC, unassessedInputs } from '../shared/domain.js';
import { FolderSorter } from '../src/FolderSorter.js';
import { profile } from './fixtures.js';
import { DEFAULT_THEME_COLOR, themeFamilies, themePalette, themePresets, validThemeColor } from '../src/theme.js';
import { AudioPlayer } from '../src/AudioPlayer.js';

test('rubric editor exposes saved presets, seven editable dimensions, stage weights and single-speaker defaults', () => {
  const html = renderToStaticMarkup(createElement(RubricEditor, {
    profile, presets: [DEFAULT_RUBRIC], busy: false,
    onChange: () => {}, onSelect: () => {}, onSave: () => {}, onDelete: () => {}, onRefresh: () => {},
  }));
  assert.match(html, /Evaluation guide \/ rubric/);
  assert.match(html, /built-in default/);
  assert.match(html, /Save as new preset/); assert.match(html, /Save changes/);
  assert.match(html, /Single-speaker default test guide/);
  assert.match(html, /Agent-only conversation default test guide/);
  assert.match(html, /Both speakers, scored separately default test guide/);
  assert.equal((html.match(/<fieldset/g) ?? []).length, 7);
  assert.equal((html.match(/class="rubric-title-button"/g) ?? []).length, 7);
  assert.match(html, /aria-label="Edit Naturalness dimension name"/);
  assert.match(html, /aria-label="Edit Audio quality dimension name"/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 21);
  assert.doesNotMatch(html, /Display name|type="number"/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rubric-dimension legend\{[^}]*font-size:1\.125rem;[^}]*font-weight:600/);
  assert.match(css, /\.rubric-dimension legend input:not\(\[type=checkbox\]\)\{[^}]*font:inherit/);
  assert.equal((html.match(/Voice Selection inclusion/g) ?? []).length, 7);
  assert.equal((html.match(/TTS inclusion/g) ?? []).length, 7);
  assert.match(html, /Checked dimensions contribute equally/);
  assert.match(html, /Audio quality is always requested/);
});

test('judge numbers, fields and remove buttons share a bottom edge and control height', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.setup-grid \.judge\{align-items:flex-end\}/);
  assert.match(css, /\.judge>\.judge-avatar,\.judge>\.icon-button,\.judge-fields input\{height:40px;min-height:40px\}/);
  assert.match(css, /\.judge>\.judge-avatar,\.judge>\.icon-button\{flex:0 0 36px;width:36px\}/);
});

test('shared surfaces keep opaque fallbacks, readable headers and flat native checkboxes', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /--mica-flyout:\s*rgb\(var\(--theme-surface-rgb\)\);/);
  assert.match(css, /--mica-header:\s*var\(--theme-header\);/);
  for (const selector of ['confirmation-dialog', 'test-action-menu', 'date-menu']) {
    const block = css.match(new RegExp(`\\.${selector}\\{([^}]+)\\}`))?.[1];
    assert.ok(block);
    assert.match(block, /background:var\(--mica-sheen\),var\(--mica-flyout\)/);
    assert.match(block, /border:1px solid var\(--mica-border\)/);
  }
  assert.match(css, /input:not\(\[type=checkbox\]\), textarea, select, \.secondary/);
  assert.match(css, /input\[type=checkbox\]\s*\{[^}]*padding:\s*0;[^}]*box-shadow:\s*none;/);
});

test('foreground layers share translucent backdrop blur with solid accessibility fallbacks', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const overlays = css.match(/\.confirmation-dialog, \.test-action-menu, \.date-menu, \.theme-menu, \.evaluation-action-bar \{([^}]+)\}/)?.[1];
  assert.ok(overlays);
  assert.match(overlays, /-webkit-backdrop-filter: var\(--mica-flyout-filter\)/);
  assert.match(overlays, /backdrop-filter: var\(--mica-flyout-filter\)/);
  const blurSupport = css.slice(css.indexOf('@supports (backdrop-filter:'), css.indexOf('@media (prefers-reduced-transparency:'));
  assert.match(overlays, /background-image: var\(--mica-flyout-sheen\)/);
  assert.match(overlays, /border-color: var\(--mica-flyout-border\)/);
  assert.match(css, /--mica-flyout-alpha: \.12;/);
  assert.match(blurSupport, /--mica-flyout: rgba\(var\(--theme-glass-rgb\), var\(--mica-flyout-alpha\)\);/);
  assert.match(blurSupport, /--mica-flyout-filter: blur\(12px\) saturate\(155%\);/);
  assert.match(blurSupport, /\.confirmation-dialog \{ background-color: rgba\(var\(--theme-glass-rgb\), \.82\); \}/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-transparency:'), css.lastIndexOf('@media (forced-colors: active)'));
  assert.match(reduced, /--mica-flyout: rgb\(var\(--theme-surface-rgb\)\);/);
  assert.match(reduced, /--mica-flyout-filter: none;/);
  assert.match(reduced, /--mica-flyout-sheen: none;/);
  const contrast = css.slice(css.lastIndexOf('@media (forced-colors: active)'));
  assert.match(contrast, /--mica-flyout: Canvas;/);
  assert.match(contrast, /--mica-flyout-filter: none;/);
});

test('hover states use contrasting fills and labels without replacing persistent selection', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /--mica-hover: var\(--theme-accent\);/);
  assert.match(css, /--mica-hover-text: #ffffff;/);
  assert.match(css, /\.test-table tbody tr:hover\{background:var\(--theme-row-hover\);box-shadow:inset 3px 0 0 var\(--theme-accent\)\}/);
  assert.match(css, /\.theme-preset:enabled:hover \{ background: var\(--mica-hover\); border-color: var\(--mica-focus\); \}/);
  assert.match(css, /select option:checked, select option:enabled:hover, select option:focus-visible \{ background: var\(--mica-hover\); color: var\(--mica-hover-text\); \}/);
  assert.match(css, /\.calendar-grid \[aria-selected=true\]>button\{background:var\(--mica-selected\)/);
  const contrast = css.slice(css.lastIndexOf('@media (forced-colors: active)'));
  assert.match(contrast, /--mica-hover-text: HighlightText;/);
  assert.match(contrast, /background: Highlight;\s*color: HighlightText;/);
});

test('workspace omits the preview badge and redundant bottom footer without disabling page scroll', () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.equal(html.includes('MULTI-JUDGE PREVIEW'), false);
  assert.equal(html.includes('<footer>'), false);
  assert.equal(html.includes('I have permission to send these audio inputs'), false);
  assert.ok(html.includes('Azure usage is billed per your deployment'));
  assert.ok(html.includes('Drop a folder or select your voice collection'));
  assert.ok(html.includes('AI opinion scores are not validated MOS'));
  assert.match(html, /<option value="single">Single speaker<\/option>/);
  assert.match(html, /<option value="agent" selected="">Agent only<\/option>/);
  assert.match(html, /<option value="both">Both, scored separately<\/option>/);
  assert.doesNotMatch(html, /<option value="customer">Customer only<\/option>/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /main \{ max-width: none; padding-bottom: 8px; \}/);
  assert.doesNotMatch(css, /(?:body|html)\s*\{[^}]*overflow:\s*hidden/);
});

test('wide layouts expand the sidebar and workspace while preserving compact breakpoints', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /width: clamp\(264px, 16vw, 440px\);/);
  assert.match(css, /main \{ max-width: none;/);
  assert.match(css, /@media \(min-width: 1201px\) \{\s*\.sidebar \{ --sidebar-padding-inline: clamp\(18px, 1\.25vw, 32px\); padding-inline: var\(--sidebar-padding-inline\); \}/);
  assert.match(css, /@media \(max-width: 1200px\) \{\s*\.sidebar \{ width: 240px; --sidebar-padding-inline: 12px; \}/);
  assert.match(css, /\.sidebar \{ width: 64px; --sidebar-padding-inline: 6px; \}/);
});

test('sidebar history rows align with navigation while the scrollbar occupies a separate lane', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /container-type: inline-size;/);
  assert.match(css, /\.history-list > \.history-item \{ width: 100cqw; \}/);
  const history = css.match(/\.sidebar-history \{\s*display: flex;([^}]+)\}/)?.[1];
  assert.ok(history);
  assert.match(history, /margin-right: calc\(-1 \* var\(--sidebar-padding-inline\)\)/);
  const list = css.match(/\.history-list \{([^}]+)\}/)?.[1];
  assert.ok(list);
  assert.match(list, /overflow: auto;/);
  assert.match(list, /padding-right: 0;/);
});

test('Color picker exposes five muted families with three shades, a custom color and reset', () => {
  const html = renderToStaticMarkup(createElement(ThemePicker));
  assert.match(html, /class="secondary theme-trigger"[^>]*aria-haspopup="dialog" aria-expanded="false"/);
  assert.match(html, /<\/span> Color<\/button>/);
  assert.match(html, /class="theme-menu" popover="auto" role="dialog" aria-label="Color &amp; shade"/);
  assert.ok(html.includes(`type="color" value="${DEFAULT_THEME_COLOR}"`));
  assert.match(html, /aria-label="Reset to default"/);
  assert.match(html, /role="status">Sage \/ Soft<\/span>/);
  assert.equal((html.match(/class="theme-preset-column"/g) ?? []).length, 5);
  assert.equal((html.match(/class="theme-preset"/g) ?? []).length, 15);
  for (const preset of themePresets) assert.ok(html.includes(`aria-label="Use ${preset.name} color"`));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('curated preset families have distinct muted shades ordered from mist to deep', () => {
  assert.deepEqual(themeFamilies.map(family => family.name), ['Sage', 'Lagoon', 'Sky', 'Iris', 'Rose']);
  assert.equal(new Set(themePresets.map(preset => preset.color)).size, 15);
  for (const family of themeFamilies) {
    const presets = themePresets.filter(preset => preset.family === family.name);
    assert.deepEqual(presets.map(preset => preset.shade), ['Mist', 'Soft', 'Deep']);
    let previousBrightness = Infinity;
    for (const preset of presets) {
      assert.equal(validThemeColor(preset.color), true);
      const channels = [1, 3, 5].map(index => Number.parseInt(preset.color.slice(index, index + 2), 16));
      assert.ok(Math.max(...channels) - Math.min(...channels) < 85, `${preset.name} should be muted`);
      const brightness = channels.reduce((sum, channel) => sum + channel, 0);
      assert.ok(brightness < previousBrightness, `${preset.name} should be deeper than the preceding shade`);
      if (Number.isFinite(previousBrightness))
        assert.ok(previousBrightness - brightness >= 105, `${preset.name} should visibly contrast with the preceding shade`);
      previousBrightness = brightness;
      assert.doesNotThrow(() => themePalette(preset.color));
    }
  }
});

test('interface palettes reject invalid colors and retain white-label contrast across the color range', () => {
  for (const color of ['', 'red', '#fff', '#12345678', '#zzzzzz', '123456', '#123456;display:none']) {
    assert.equal(validThemeColor(color), false);
    assert.throws(() => themePalette(color), /six-digit hex color/);
  }
  assert.equal(themePalette('#ABCDEF')['--theme-color'], '#abcdef');
  const defaultPalette = themePalette(DEFAULT_THEME_COLOR);
  const changedKeys = ['--theme-page', '--theme-glow', '--theme-surface-rgb', '--theme-panel-rgb', '--theme-sidebar-rgb', '--theme-inset-rgb', '--theme-selected', '--theme-header', '--theme-accent', '--theme-text', '--theme-muted'];
  const violet = themePalette('#7c3aed');
  for (const key of changedKeys) assert.notEqual(violet[key], defaultPalette[key], key);
  for (const r of [0, 51, 102, 153, 204, 255]) for (const g of [0, 51, 102, 153, 204, 255]) for (const b of [0, 51, 102, 153, 204, 255]) {
    const color = '#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('');
    const palette = themePalette(color);
    const glass = palette['--theme-glass-rgb'].split(',').map(Number);
    assert.ok(glass.every(channel => channel >= 200 && channel <= 255), `Readable glass tint for ${color}`);
    const luminanceOf = (channels: number[]) => channels.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const rowHover = palette['--theme-row-hover'].match(/\d+/g)!.map(Number);
    const surface = palette['--theme-surface-rgb'].split(',').map(Number);
    const text = palette['--theme-text'].match(/\d+/g)!.map(Number);
    const muted = palette['--theme-muted'].match(/\d+/g)!.map(Number);
    const accent = palette['--theme-accent'].match(/\d+/g)!.map(Number);
    assert.ok(text.every((channel, i) => channel <= accent[i]), `Darker themed foreground for ${color}`);
    for (const [name, foreground] of [['body', text], ['muted', muted]] as const) {
      assert.ok((luminanceOf(surface) + .05) / (luminanceOf(foreground) + .05) >= 4.5, `${name} text contrast on surfaces for ${color}`);
      assert.ok((luminanceOf(rowHover) + .05) / (luminanceOf(foreground) + .05) >= 4.5, `${name} text contrast on hovered rows for ${color}`);
    }
    assert.ok((luminanceOf(surface) + .05) / (luminanceOf(rowHover) + .05) >= 1.3, `Visible row hover fill for ${color}`);
    const primaryHover = palette['--theme-accent-hover'].match(/\d+/g)!.map(Number);
    assert.ok(1.05 / (luminanceOf(primaryHover) + .05) >= 4.5, `White primary hover label contrast for ${color}`);
    const darkestDialogGlass = glass.map(channel => .06 * 255 + .94 * .82 * channel);
    assert.ok((luminanceOf(darkestDialogGlass) + .05) / (luminanceOf(text) + .05) >= 4.5, `Dark foreground contrast over dimmed dialog glass for ${color}`);
    const channels = palette['--theme-accent'].match(/\d+/g)!.map(Number).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    assert.ok(1.05 / (luminance + .05) >= 4.5, `White-label contrast for ${color}`);
    assert.equal(Object.keys(palette).some(key => key.startsWith('--mica-')), false, 'Custom colors must not override accessibility surface tokens.');
  }
});

test('calendar date arithmetic validates leap days and keeps month shifts and week grids stable', () => {
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '26-01-01', '2026-1-1', '', 'invalid'])
    assert.equal(parseCalendarDate(invalid), undefined);
  for (const valid of ['2024-02-29', '2026-10-23', '0001-01-01', '9999-12-31'])
    assert.equal(calendarDateKey(parseCalendarDate(valid)!), valid);
  assert.equal(calendarDateKey(shiftCalendarMonth(parseCalendarDate('2026-01-31')!, 1)), '2026-02-28');
  assert.equal(calendarDateKey(shiftCalendarMonth(parseCalendarDate('2024-02-29')!, 12)), '2025-02-28');
  assert.equal(calendarDateKey(shiftCalendarMonth(parseCalendarDate('2026-01-15')!, -1)), '2025-12-15');
  const days = calendarDays(parseCalendarDate('2026-10-23')!);
  assert.equal(days.length, 42);
  assert.equal(days[0].getUTCDay(), 0);
  assert.equal(calendarDateKey(days[0]), '2026-09-27');
  assert.equal(calendarDateKey(days[41]), '2026-11-07');
  assert.equal(new Set(days.map(calendarDateKey)).size, 42);
});

test('date filters render an accessible themed calendar instead of the browser native date popup', () => {
  const html = renderToStaticMarkup(createElement(DatePicker, {
    label: 'From date', value: '2026-10-23', min: '2026-10-01', max: '2026-10-31', onChange: () => {},
  }));
  assert.equal(html.includes('type="date"'), false);
  assert.match(html, /type="text"[^>]*placeholder="YYYY-MM-DD"/);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false"/);
  assert.match(html, /class="date-menu" popover="auto" role="dialog" aria-label="From date calendar"/);
  assert.match(html, /role="grid" aria-label="October 2026"/);
  assert.equal((html.match(/role="gridcell"/g) ?? []).length, 42);
  assert.match(html, /role="gridcell" aria-selected="true"><button[^>]*data-day="2026-10-23"/);
  assert.equal((html.match(/<button[^>]*data-day=[^>]*disabled=""/g) ?? []).length, 11);
  assert.match(html, /aria-label="Previous month" disabled=""/);
  assert.match(html, /aria-label="Next month" disabled=""/);
  assert.match(html, />Clear<\/button>/);
  assert.match(html, />Today<\/button>/);
});

test('calendar triggers share their input bounds and reserve space for centered icons', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.date-control\{[^}]*display:flex/);
  assert.match(css, /\.date-control input\{padding-right:44px\}/);
  assert.match(css, /\.date-control>\.date-trigger\{[^}]*right:0;top:0;bottom:0;width:36px;[^}]*place-items:center/);
});

test('native dropdown theming is feature-detected and supports system high-contrast colors', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /@supports \(appearance: base-select\)/);
  assert.match(css, /select, select::picker\(select\) \{ appearance: base-select; \}/);
  assert.match(css, /select:not\(\[multiple\]\) \{ position: relative; padding-right: 32px; \}/);
  assert.match(css, /select::picker-icon \{[^}]*position: absolute;[^}]*right: 12px;[^}]*top: 50%;/);
  const picker = css.match(/select::picker\(select\) \{\s*padding:([\s\S]*?)\n  \}/)?.[1];
  assert.ok(picker);
  assert.match(picker, /background: var\(--mica-flyout-sheen\), var\(--mica-flyout\)/);
  assert.match(picker, /box-shadow: var\(--mica-flyout-shadow\)/);
  assert.match(picker, /backdrop-filter: var\(--mica-flyout-filter\)/);
  const highContrast = css.slice(css.lastIndexOf('@media (forced-colors: active)'));
  for (const declaration of ['--mica-flyout: Canvas;', '--mica-header: Canvas;', '--mica-border: CanvasText;', 'color: HighlightText;'])
    assert.ok(highContrast.includes(declaration));
});

function entries(count: number): TestHistory[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index), name: `Test ${index + 1}`, createdAt: new Date(2026, 9, 1, 12, index).toISOString(),
    status: 'completed', stage: 'audition', clips: 2,
    voices: [`Talent ${index}`], languages: [index % 2 ? 'English' : 'Italian'],
    genders: [index % 2 ? 'Female' : 'Male'],
    bestScore: index === 0 ? null : index / 20,
    bestVoices: index === 0 ? [] : [{ voice: `Talent ${index}`, role: 'speaker' }],
  }));
}

test('Completed* identifies any missing, failed, unassessable or partial assessment without changing saved status', () => {
  const complete = job();
  assert.equal(testStatusLabel(testHistory(complete)), 'Completed');
  for (const change of [
    (value: typeof complete) => { value.results[0].assessment!.assessable = false; },
    (value: typeof complete) => { value.results[0].assessment!.languageSupported = false; },
    (value: typeof complete) => { value.results[0].assessment!.scores.naturalness = null; },
    (value: typeof complete) => { value.results[0].status = 'failed'; delete value.results[0].assessment; },
    (value: typeof complete) => { value.results.shift(); },
    (value: typeof complete) => { value.profile.speakerMode = 'automatic'; },
  ]) {
    const value = structuredClone(complete);
    change(value);
    assert.equal(testStatusLabel(testHistory(value)), 'Completed*');
    assert.ok(unassessedInputs(value).length);
    assert.equal(value.status, 'completed', 'Completion marker is derived, not a new persisted job status.');
    value.status = 'running';
    assert.equal(testStatusLabel(testHistory(value)), 'Running');
  }
  const diagnostic = structuredClone(complete);
  diagnostic.results[0].assessment!.scores.audioQuality = null;
  assert.equal(testHistory(diagnostic).incomplete, false, 'An excluded diagnostic score is not a missing required assessment.');
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(TestLibrary, {
    entries: [{ ...testHistory(complete), incomplete: true }], busy: false, pageSize: 30, onPageSizeChange: noop,
    selectedIds: [], onSelectionChange: noop, onExportSelected: noop, onBulkAction: noop, onRetryUnassessed: noop, onOpen: noop, onEdit: noop,
    onDelete: noop, onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  assert.match(html, />Completed\*<\/span>/);
});

test('test status labels use title case without changing stored status or semantic color classes', () => {
  for (const status of ['completed', 'running', 'queued', 'interrupted', 'cancelled'] as const)
    assert.equal(testStatusLabel({ status }), status[0].toUpperCase() + status.slice(1));
  assert.equal(testStatusLabel({ status: 'completed', incomplete: true }), 'Completed*');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-badge \{ color: var\(--theme-heading\); text-transform: capitalize; \}/);
});

test('sidebar expansion loads another batch in place rather than linking to the test library', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /history\.slice\(0, recentLimit\)/);
  assert.match(source, /onClick=\{\(\) => setRecentLimit\(limit => limit \+ RECENT_TEST_BATCH\)\}/);
  assert.doesNotMatch(source, />View all /);
  assert.doesNotMatch(source, />Back to all tests</);
});

test('compact list renders 30 rows, separate fields and one quick-action dropdown per test', () => {
  const values = entries(61);
  values[59].status = 'running';
  values[58].status = 'queued';
  values[60].bestVoices = ['Talent 60', 'Tied talent B', 'Tied talent C'].map(voice => ({ voice, role: 'speaker' }));
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(TestLibrary, {
    entries: values, busy: false, pageSize: 30, onPageSizeChange: noop, selectedIds: [], onSelectionChange: noop, onExportSelected: noop, onBulkAction: noop, onRetryUnassessed: noop, onOpen: noop, onEdit: noop, onDelete: noop,
    onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.match(html, /<h1>Test Reports<\/h1>/);
  assert.ok(body);
  assert.equal((body.match(/<tr>/g) ?? []).length, 30);
  assert.match(html, /Tests per page<select/);
  for (const size of TEST_PAGE_SIZES) assert.match(html, new RegExp(`<option value="${size}"[^>]*>${size}</option>`));
  assert.match(html, /separate voice-name, overall-score and per-judge average-score columns/);
  assert.doesNotMatch(html, />Export selected report<\/button>/);
  assert.equal((body.match(/class="secondary test-action-button"/g) ?? []).length, 30);
  assert.equal((body.match(/aria-haspopup="menu"/g) ?? []).length, 30);
  assert.equal((body.match(/popover="auto" role="menu"/g) ?? []).length, 30);
  assert.equal((body.match(/aria-label="Actions for /g) ?? []).length, 60);
  assert.equal(body.includes('test-action-select'), false);
  assert.equal((body.match(/aria-label="Select test /g) ?? []).length, 30);
  assert.equal((body.match(/type="checkbox"[^>]*disabled=""/g) ?? []).length, 2);
  assert.match(html, /aria-label="Select all eligible tests on this page"/);
  for (const field of ['Test name', 'Test time', 'Test type', 'Best voice', 'Best score', 'Language', 'Gender', 'Actions']) {
    assert.equal((body.match(new RegExp(`data-label="${field}"`, 'g')) ?? []).length, 30);
    assert.ok(html.includes(`<th scope="col">${field}</th>`));
  }
  assert.match(html, /\+2 tied/);
  assert.match(html, /title="Talent 60 \/ speaker, Tied talent B \/ speaker, Tied talent C \/ speaker"/);
  const toolbar = html.split('<div class="test-filters">')[1]?.split('<div class="test-list-meta">')[0];
  assert.ok(toolbar);
  assert.equal((toolbar.match(/<label/g) ?? []).length, 8);
  assert.match(toolbar, /<label>Test type<select>/);
  assert.match(toolbar, /<option value=""[^>]*>All test types<\/option>/);
  assert.match(toolbar, /<option value="audition">Voice Selection<\/option>/);
  assert.match(toolbar, /<option value="tts">TTS evaluation<\/option>/);
  assert.match(toolbar, /<label>Test Status<select>/);
  assert.match(toolbar, /<option value=""[^>]*>All statuses<\/option>/);
  for (const status of TEST_STATUS_FILTERS)
    assert.match(toolbar, new RegExp(`<option value="${status}">${status === 'incomplete' ? 'Completed\\*' : testStatusLabel({ status })}</option>`));
  assert.match(toolbar, /<label[^>]*>From date<\/label>/);
  assert.match(toolbar, /<label[^>]*>To date<\/label>/);
  assert.equal((toolbar.match(/class="date-menu"/g) ?? []).length, 2);
  assert.equal(toolbar.includes('<details'), false);
  assert.equal(html.includes('About these fields'), false);
  assert.equal(html.includes('test-list-help'), false);
  assert.equal(html.includes('<dialog'), false);
  assert.equal(html.includes('test-action-dialog'), false);
  assert.equal((body.match(/data-action="edit" disabled=""/g) ?? []).length, 2);
  assert.equal((body.match(/data-action="delete" class="danger" disabled=""/g) ?? []).length, 2);
  for (const action of ['edit', 'rerun', 'delete', 'json', 'assessments', 'voices', 'guidance'])
    assert.equal((body.match(new RegExp(`data-action="${action}"`, 'g')) ?? []).length, 30);
});

test('report page size controls, row counts, captions and ranges agree for every supported choice', () => {
  const noop = () => {};
  for (const size of TEST_PAGE_SIZES) {
    const html = renderToStaticMarkup(createElement(TestLibrary, {
      entries: entries(105), busy: false, pageSize: size, onPageSizeChange: noop,
      selectedIds: ['64'], onSelectionChange: noop, onExportSelected: noop, onBulkAction: noop, onRetryUnassessed: noop, onOpen: noop, onEdit: noop, onDelete: noop,
      onDownload: noop, onRegenerate: noop, onRefresh: noop,
    }));
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
    assert.ok(body);
    assert.equal((body.match(/<tr>/g) ?? []).length, size);
    assert.ok(html.includes(`Saved evaluations, up to ${size} tests per page`));
    assert.ok(html.includes(`1-${size} shown`));
    assert.match(html, new RegExp(`<option value="${size}" selected="">${size}</option>`));
    assert.match(html, /1 selected/);
  }
});

test('the themed action menu disables its trigger and every action during an operation', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(TestActions, {
    entry: entries(1)[0], busy: true, onEdit: noop, onDelete: noop, onRegenerate: noop, onDownload: noop,
  }));
  assert.match(html, /aria-haspopup="menu" aria-expanded="false"/);
  const target = html.match(/popovertarget="([^"]+)"/i)?.[1];
  assert.ok(target);
  assert.ok(html.includes(`<div id="${target}"`));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 8);
  assert.equal((html.match(/role="menuitem"/g) ?? []).length, 7);
});

test('test summaries extract language and gender only from the test name while retaining eligible score ties', () => {
  const value = job([
    clip({ voice: 'Female in folder name', language: 'British English' }),
    clip({ voice: 'Talent B', file: 'other/two.wav', language: 'Italian' }),
  ], [4]);
  value.voiceLabels = [{ voice: 'Talent B', gender: 'Other' }];
  value.name = 'ko-KR Female VTS';
  value.results[1].assessment!.language = 'Italian';
  const snapshot = JSON.stringify(value);
  const summary = testHistory(value);
  assert.equal(summary.name, value.name);
  assert.equal(summary.bestScore, 4);
  assert.deepEqual(summary.bestVoices.map(voice => voice.voice), ['Female in folder name', 'Talent B']);
  assert.deepEqual(summary.genders, ['Female']);
  assert.deepEqual(summary.languages, ['ko-KR']);
  assert.equal(JSON.stringify(value), snapshot);
  value.results[0].status = 'failed';
  assert.deepEqual(testHistory(value).bestVoices, [{ voice: 'Talent B', role: 'speaker' }]);
  value.results[1].status = 'failed';
  assert.equal(testHistory(value).bestScore, null);
  assert.deepEqual(testHistory(value).bestVoices, []);
  delete value.name;
  const unnamed = testHistory(value);
  assert.equal(unnamed.name, 'Untitled evaluation');
  assert.deepEqual(unnamed.languages, []);
  assert.deepEqual(unnamed.genders, ['Unspecified'], 'Do not fall back to audio, hints, folders or saved voice labels.');
});

test('bulk selection counts eligible tests across pages and excludes running and queued tests', () => {
  const values = entries(61);
  values[59].status = 'running'; values[58].status = 'queued';
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(TestLibrary, {
    entries: values, busy: false, pageSize: 30, onPageSizeChange: noop, selectedIds: ['0', '60', '59', '58', 'deleted'],
    onSelectionChange: noop, onExportSelected: noop, onBulkAction: noop, onRetryUnassessed: noop, onOpen: noop, onEdit: noop, onDelete: noop,
    onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  assert.match(html, /2 selected/);
  assert.match(html, /Delete selected/);
  assert.match(html, /Redo selected/);
  assert.match(html, /<div class="test-bulk-actions"[^>]*>[\s\S]*?>Export selected report<\/button>/);
  assert.match(html, /Clear selection/);
  assert.match(html, /aria-label="Select test Test 61"[^>]*checked=""/);
  assert.equal((html.match(/aria-label="Select test [^"]*"[^>]*checked=""/g) ?? []).length, 1);
});

test('one-click selected retries include only Completed* tests across pages and disable while busy', () => {
  for (const status of ['completed', 'running', 'queued', 'cancelled', 'interrupted'] as const) {
    assert.equal(canRetryUnassessedTest({ status, incomplete: true }), status === 'completed');
    assert.equal(canRetryUnassessedTest({ status, incomplete: false }), false);
    assert.equal(canRetryUnassessedTest({ status }), false);
  }
  const values = entries(61);
  values[0].incomplete = true;
  values[60].incomplete = true;
  values[59].status = 'running'; values[59].incomplete = true;
  values[58].status = 'queued'; values[58].incomplete = true;
  const noop = () => {};
  const render = (selectedIds: string[], busy = false) => renderToStaticMarkup(createElement(TestLibrary, {
    entries: values, busy, pageSize: 30, onPageSizeChange: noop, selectedIds,
    onSelectionChange: noop, onExportSelected: noop, onBulkAction: noop, onRetryUnassessed: noop,
    onOpen: noop, onEdit: noop, onDelete: noop, onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  const selectedIds = ['0', '60', '59', '58', '1', 'deleted'];
  assert.match(render(selectedIds), />Retry all unassessable \(2\)<\/button>/);
  assert.match(render(selectedIds, true), /<button[^>]*disabled=""[^>]*>Retry all unassessable \(2\)<\/button>/);
  assert.doesNotMatch(render(['1', '59', '58']), />Retry all unassessable/);
  assert.match(render(selectedIds), /class="status-badge completed" data-incomplete="true"/);
  assert.match(render(selectedIds), /class="status-badge completed" data-incomplete="false"/);
});

test('Completed* has lighter semantic greens and retains system high-contrast rendering', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-badge\.completed\[data-incomplete=true\] \{ background: #effbf2; color: #39734a; \}/);
  assert.match(css, /\.history-item \.status-badge\.completed\[data-incomplete=true\] \{ background: none; color: #d6e5d9; \}/);
  const forcedColors = css.split('@media (forced-colors: active)')[1];
  assert.match(forcedColors, /\.status-badge\.completed\[data-incomplete=true\], \.history-item \.status-badge\.completed\[data-incomplete=true\],[^}]*background: Canvas; color: CanvasText;/);
});

test('confirmation uses a named modal dialog with a description instead of an inline card', () => {
  const html = renderToStaticMarkup(createElement(ConfirmationDialog, {
    title: 'Delete selected tests?', description: 'Deletion cannot be undone.', busy: false, onCancel: () => {},
    children: createElement('button', { 'data-dialog-cancel': '' }, 'Cancel'),
  }));
  assert.match(html, /<dialog/); assert.match(html, /class="confirmation-dialog"/);
  assert.match(html, /role="alertdialog"/); assert.match(html, /aria-labelledby=/); assert.match(html, /aria-describedby=/);
  assert.match(html, /Deletion cannot be undone/); assert.equal(html.includes('aria-modal="false"'), false);
  assert.match(html, /data-dialog-cancel=""/);
});

test('name extraction handles existing locale names, compact locales, case and separator variations', () => {
  for (const [name, language, gender] of [
    ['ko-KR Female VTS', 'ko-KR', 'Female'],
    ['id-ID Male VTS', 'id-ID', 'Male'],
    ['de-DE Female VTS', 'de-DE', 'Female'],
    ['es-ES Female VTS', 'es-ES', 'Female'],
    ['ja-JP Female VTS', 'ja-JP', 'Female'],
    ['th-TH Female MatchFile', 'th-TH', 'Female'],
    ['thTH Male Cartesia', 'th-TH', 'Male'],
    ['en-GB Female VTS', 'en-GB', 'Female'],
    ['ms-MY Male VTS', 'ms-MY', 'Male'],
    ['fr-FR Male VTS', 'fr-FR', 'Male'],
    ['EN_gb_fEmAlE_VTS', 'en-GB', 'Female'],
    ['en-GB F VTS', 'en-GB', 'Female'],
    ['thTH M Cartesia', 'th-TH', 'Male'],
    ['ko-KR_f_VTS', 'ko-KR', 'Female'],
    ['fr-FR-m-round2', 'fr-FR', 'Male'],
    ['zh-Hant-TW Non-binary round 2', 'zh-Hant-TW', 'Other'],
  ]) assert.deepEqual(testNameMetadata(name), { languages: [language], genders: [gender] }, name);
  assert.deepEqual(testNameMetadata('Female audition'), { languages: [], genders: ['Female'] }, 'Female must not also match Male.');
  assert.deepEqual(testNameMetadata('Retail test'), { languages: [], genders: ['Unspecified'] });
  assert.deepEqual(testNameMetadata('en-GB en_GB Female Male'), { languages: ['en-GB'], genders: ['Female', 'Male'] });
  assert.deepEqual(testNameMetadata('NotFemale malevolent xx-YY'), { languages: [], genders: ['Unspecified'] });
  assert.deepEqual(testNameMetadata('en-US M/F'), { languages: ['en-US'], genders: ['Female', 'Male'] });
  assert.deepEqual(testNameMetadata('FM M2 F1 format'), { languages: [], genders: ['Unspecified'] });
});

test('name-derived metadata drives filters and refreshes when the test is renamed', () => {
  const value = job([clip({ voice: 'Female folder', language: 'Italian' })], [4]);
  value.name = 'thTH Male Cartesia';
  value.voiceLabels = [{ voice: 'Female folder', gender: 'Female' }];
  const filters = { ...defaultTestFilters, language: 'th-TH', gender: 'Male' };
  assert.equal(queryTests([testHistory(value)], filters, 1).total, 1);
  value.name = 'en-GB Female VTS';
  assert.equal(queryTests([testHistory(value)], filters, 1).total, 0);
  assert.equal(queryTests([testHistory(value)], { ...filters, language: 'en-GB', gender: 'Female' }, 1).total, 1);
  assert.equal(testHistory(value).bestScore, 4);
});

test('pagination caps every page at 30 tests and clamps stale pages after filtering or deletion', () => {
  const values = entries(61);
  const snapshot = JSON.stringify(values);
  const first = queryTests(values, defaultTestFilters, 1);
  const second = queryTests(values, defaultTestFilters, 2);
  const third = queryTests(values, defaultTestFilters, 3);
  assert.deepEqual([first.entries.length, second.entries.length, third.entries.length], [30, 30, 1]);
  assert.equal(first.total, 61);
  assert.equal(first.pages, 3);
  assert.equal(new Set([...first.entries, ...second.entries, ...third.entries].map(value => value.id)).size, 61);
  assert.equal(queryTests(values.slice(0, 30), defaultTestFilters, 3).page, 1);
  assert.equal(queryTests(values.slice(0, 31), defaultTestFilters, 2).entries.length, 1);
  assert.equal(queryTests(values, defaultTestFilters, -10).page, 1);
  assert.equal(queryTests([], defaultTestFilters, 99).pages, 1);
  assert.equal(JSON.stringify(values), snapshot);
});

test('search and combined filters apply before pagination and search all saved tests', () => {
  const values = entries(65);
  const filtered = queryTests(values, { ...defaultTestFilters, language: 'english', gender: 'Female' }, 2);
  assert.equal(filtered.total, 32);
  assert.equal(filtered.entries.length, 2);
  assert.ok(filtered.entries.every(entry => entry.languages.includes('English') && entry.genders.includes('Female')));
  assert.equal(queryTests(values, { ...defaultTestFilters, search: '  TEST 65 ' }, 1).entries[0].id, '64');
  assert.equal(queryTests(values, { ...defaultTestFilters, search: 'Talent 64' }, 1).total, 1);
  assert.equal(queryTests(values, { ...defaultTestFilters, search: 'Italian', gender: 'Female' }, 1).total, 0);
  assert.equal(queryTests(values, { ...defaultTestFilters, gender: 'Unspecified' }, 1).total, 0);
});

test('test type filters use saved stages and combine with other filters before pagination', () => {
  const values = entries(240);
  values.forEach((entry, index) => {
    entry.stage = index % 3 === 0 ? 'tts' : 'audition';
    entry.status = index % 5 === 0 ? 'cancelled' : 'completed';
  });
  values[1].name = 'TTS evaluation';
  for (const stage of ['audition', 'tts'] as const) {
    const expected = values.filter(entry => entry.stage === stage);
    for (const size of TEST_PAGE_SIZES) {
      const last = queryTests(values, { ...defaultTestFilters, stage }, 99, size);
      assert.equal(last.total, expected.length);
      assert.equal(last.page, Math.ceil(expected.length / size));
      assert.equal(last.entries.length, (expected.length - 1) % size + 1);
      const all = Array.from({ length: last.pages }, (_, page) =>
        queryTests(values, { ...defaultTestFilters, stage }, page + 1, size).entries).flat();
      assert.ok(all.every(entry => entry.stage === stage));
      assert.deepEqual(all.map(entry => entry.id).sort(), expected.map(entry => entry.id).sort());
    }
  }
  const combined = queryTests(values, {
    ...defaultTestFilters, stage: 'tts', status: 'completed', search: 'Talent 6',
    language: 'Italian', gender: 'Male', dateFrom: '2026-10-01', dateTo: '2026-10-01',
  }, 99);
  assert.deepEqual(combined.entries.map(entry => entry.id).sort(), ['6', '66']);
  assert.equal(combined.page, 1);
  assert.equal(queryTests(values, { ...defaultTestFilters, stage: 'tts', language: 'Spanish' }, 99).total, 0);
  assert.equal(queryTests(values, defaultTestFilters, 1).total, 240);
  assert.equal(defaultTestFilters.stage, '');
});

test('status filters separate Completed from Completed* and combine globally with the other filters', () => {
  const values = entries(240);
  values.forEach((entry, index) => {
    const status = TEST_STATUS_FILTERS[index % TEST_STATUS_FILTERS.length];
    entry.status = status === 'incomplete' ? 'completed' : status;
    entry.incomplete = status === 'incomplete';
  });
  for (const status of TEST_STATUS_FILTERS) {
    const result = queryTests(values, { ...defaultTestFilters, status }, 99);
    assert.equal(result.total, 40);
    assert.equal(result.page, 2);
    assert.equal(result.entries.length, 10);
    assert.ok(result.entries.every(entry => testStatusLabel(entry) === (status === 'incomplete' ? 'Completed*' : testStatusLabel({ status }))));
  }
  const combined = queryTests(values, {
    ...defaultTestFilters, status: 'completed', search: 'Talent 6', language: 'Italian', gender: 'Male',
    dateFrom: '2026-10-01', dateTo: '2026-10-01',
  }, 1);
  assert.deepEqual(combined.entries.map(entry => entry.id).sort(), ['6', '60', '66'].sort());
  assert.equal(queryTests(values, defaultTestFilters, 1).total, 240);
  assert.equal(defaultTestFilters.status, '');
});

test('pagination supports 30, 40, 50 and 100 rows with global filtering and stale-page clamping', () => {
  assert.deepEqual(TEST_PAGE_SIZES, [30, 40, 50, 100]);
  const values = entries(101);
  for (const size of TEST_PAGE_SIZES) {
    const first = queryTests(values, defaultTestFilters, 1, size);
    assert.equal(first.entries.length, size);
    assert.equal(first.pages, Math.ceil(values.length / size));
    const all = Array.from({ length: first.pages }, (_, index) =>
      queryTests(values, defaultTestFilters, index + 1, size).entries).flat();
    assert.equal(all.length, values.length);
    assert.equal(new Set(all.map(entry => entry.id)).size, values.length);
    assert.deepEqual(all.map(entry => entry.id), [...values].reverse().map(entry => entry.id));
    assert.equal(queryTests(values.slice(0, size), defaultTestFilters, 99, size).page, 1);
    const filtered = queryTests(values, { ...defaultTestFilters, gender: 'Female' }, 99, size);
    assert.equal(filtered.total, 50);
    assert.equal(filtered.page, Math.ceil(50 / size));
    assert.ok(filtered.entries.every(entry => entry.genders.includes('Female')));
    const empty = queryTests([], defaultTestFilters, 99, size);
    assert.deepEqual([empty.entries.length, empty.pages, empty.page], [0, 1, 1]);
  }
  for (const size of [0, 29, 31, 41, 51, 101, 1000, NaN, Infinity])
    assert.throws(() => queryTests(values, defaultTestFilters, 1, size), /30, 40, 50 or 100/);
});

function csvTable(csv: string) {
  const rows = csv.replace(/^\uFEFF/, '').split('\r\n').map(row =>
    [...row.matchAll(/"((?:[^"]|"")*)"(?=,|$)/g)].map(match => match[1].replaceAll('""', '"')));
  const [headers, ...data] = rows;
  assert.equal(new Set(headers).size, headers.length, 'Column headers must be unique.');
  for (const row of data) assert.equal(row.length, headers.length, 'Every test row must match the dynamic column count.');
  return { headers, rows: data.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]]))) };
}

test('selected-test CSV separates names, overall scores and judge scores for tied and other voices', () => {
  const scored = job([
    clip({ voice: 'Winner' }), clip({ voice: 'Tied, "voice"', role: 'agent' }),
    clip({ voice: 'Other' }), clip({ voice: 'Unassessed' }),
  ], [4]);
  scored.name = 'en-GB F, "round 2"';
  scored.results[2].assessment = { ...scored.results[2].assessment!, scores: {
    ...scored.results[2].assessment!.scores, naturalness: 2, articulation: 2, pace: 2, expressiveness: 2,
  } };
  scored.results[3].status = 'failed';
  const unscored = job([clip({ voice: 'Only voice' })], [4]);
  unscored.name = 'No metadata';
  unscored.results[0].status = 'failed';
  const values = [scored, unscored];
  const snapshot = JSON.stringify(values);
  const csv = testTableCsv(values);
  const table = csvTable(csv);
  assert.equal(table.headers.length, 17, 'Five metadata columns and four voice groups of three columns.');
  assert.ok(table.headers.every(header => !/\brole\b/i.test(header)), 'No role columns are exported.');
  const [first, second] = table.rows;
  assert.equal(first['Test name'], scored.name);
  assert.equal(first['Test time'], scored.createdAt);
  assert.equal(first['Test type'], 'Voice Selection');
  assert.equal(first.Locale, 'en-GB');
  assert.equal(first.Gender, 'Female');
  assert.equal(first['Best voice 1 name'], 'Tied, "voice"');
  assert.equal(first['Best voice 1 overall score'], '4.00');
  assert.equal(first['Best voice 1 - Judge 1 (deployment-0) average score'], '4.00');
  assert.equal(first['Best voice 2 name'], 'Winner');
  assert.equal(first['Other voice 1 name'], 'Other');
  assert.equal(first['Other voice 1 overall score'], '2.00');
  assert.equal(first['Other voice 1 - Judge 1 (deployment-0) average score'], '2.00');
  assert.equal(first['Other voice 2 name'], 'Unassessed');
  assert.equal(first['Other voice 2 overall score'], 'Not assessed');
  assert.equal(first['Other voice 2 - Judge 1 (deployment-0) average score'], 'Not assessed');
  assert.equal(second['Best voice 1 name'], '');
  assert.equal(second['Best voice 1 overall score'], 'Not assessed');
  assert.equal(second['Best voice 2 overall score'], '');
  assert.equal(second['Other voice 1 name'], 'Only voice');
  assert.equal(second['Other voice 2 name'], '');
  assert.equal(second.Locale, 'Not specified');
  assert.equal(second.Gender, 'Unspecified');
  assert.equal(testTableCsv(Array.from({ length: 65 }, () => scored)).split('\r\n').length, 66, 'Exports are not limited to the visible page.');
  assert.equal(testTableCsv([]), '\uFEFF"Test name","Test time","Test type","Locale","Gender","Best voice name","Best voice overall score"');
  assert.equal(JSON.stringify(values), snapshot);
  const only = job([clip({ voice: 'Only winner' })], [5]);
  const single = csvTable(testTableCsv([only]));
  assert.equal(single.rows[0]['Best voice name'], 'Only winner');
  assert.equal(single.rows[0]['Best voice overall score'], '5.00');
  assert.ok(single.headers.every(header => !header.startsWith('Other voice')));
});

test('history and selected CSVs choose higher naturalness for tied overall scores and retain true ties', () => {
  const value = job([clip({ voice: 'Alpha' }), clip({ voice: 'Zulu' })], [4]);
  value.results[0].assessment!.scores.naturalness = 3;
  value.results[0].assessment!.scores.articulation = 5;
  value.results[1].assessment!.scores.naturalness = 5;
  value.results[1].assessment!.scores.articulation = 3;
  const snapshot = JSON.stringify(value);
  assert.deepEqual(testHistory(value).bestVoices, [{ voice: 'Zulu', role: 'speaker' }]);
  const unique = csvTable(testTableCsv([value]));
  assert.equal(unique.rows[0]['Best voice name'], 'Zulu');
  assert.equal(unique.rows[0]['Best voice overall score'], '4.00');
  assert.equal(unique.rows[0]['Other voice 1 name'], 'Alpha');
  assert.equal(unique.rows[0]['Other voice 1 overall score'], '4.00');
  assert.ok(!unique.headers.includes('Best voice 2 name'));
  assert.equal(JSON.stringify(value), snapshot);
  value.results[0].assessment!.scores.naturalness = 5;
  value.results[0].assessment!.scores.articulation = 3;
  assert.deepEqual(testHistory(value).bestVoices.map(voice => voice.voice), ['Alpha', 'Zulu']);
  const tied = csvTable(testTableCsv([value]));
  assert.equal(tied.rows[0]['Best voice 1 name'], 'Alpha');
  assert.equal(tied.rows[0]['Best voice 2 name'], 'Zulu');
});

test('selected reports preserve per-judge duration-weighted regions and equal recording averages', () => {
  const value = job([
    clip({ file: 'a.wav', start: 0, end: 1 }),
    clip({ file: 'a.wav', start: 1, end: 4 }),
    clip({ file: 'b.wav', start: 0, end: 1 }),
  ], [4, 4]);
  const scores = [2, 4, 4, 2, 1, 5];
  value.results.forEach((result, index) => { result.assessment = assessment(scores[index]); });
  const row = csvTable(testTableCsv([value])).rows[0];
  assert.equal(row['Best voice overall score'], '3.00');
  assert.equal(row['Best voice - Judge 1 (deployment-0) average score'], '2.25');
  assert.equal(row['Best voice - Judge 2 (deployment-1) average score'], '3.75');
});

test('test type is visible for both evaluation stages in list rows and selected-test CSVs', () => {
  const noop = () => {};
  const values = entries(2);
  values[0].stage = 'tts';
  const html = renderToStaticMarkup(createElement(TestLibrary, {
    entries: values, busy: false, pageSize: 30, onPageSizeChange: noop,
    selectedIds: [], onSelectionChange: noop, onExportSelected: noop, onBulkAction: noop, onRetryUnassessed: noop,
    onOpen: noop, onEdit: noop, onDelete: noop, onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  assert.match(html, /data-label="Test type">TTS evaluation<\/td>/);
  assert.match(html, /data-label="Test type">Voice Selection<\/td>/);
  const human = job();
  const tts = job(); tts.profile = { ...tts.profile, stage: 'tts' };
  assert.deepEqual(csvTable(testTableCsv([human, tts])).rows.map(row => row['Test type']), ['Voice Selection', 'TTS evaluation']);
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /testType: testType\(job.profile.stage\)/, 'JSON report exports include the readable type.');
  assert.match(source, /const rubricColumns = \[[^\n]*'test_type'/);
  assert.match(source, /return \[[^\n]*testType\(profile.stage\)/, 'All CSV exports using rubric cells include type.');
});

test('setup sections support native collapse and queue/start actions live in the fixed action region', () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.equal((html.match(/<details class="card setup-section" open=""/g) ?? []).length, 2);
  assert.match(html, /<summary><span>01 · Choose your evaluation/);
  assert.match(html, /<summary><span>02 · Your judging panel/);
  assert.match(html, /class="evaluation-action-bar" role="region" aria-label="Evaluation actions"/);
  assert.match(html, /Review readiness &amp; usage/);
  assert.match(html, /class="setup-grid" data-evaluation-open="true" data-panel-open="true"/);
  assert.match(html, /<details class="card recordings-card setup-section" open=""/);
  assert.match(html, /<summary><span>03 · Bring your recordings/);
  assert.match(html, /0 recordings · 0 voices · 0 included/);
  assert.match(html, />Add to queue<\/button>/);
  assert.match(html, /03<\/span> Folder sorting/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.evaluation-action-bar\{position:fixed;bottom:0;/);
  const actionBar = css.match(/\.evaluation-action-bar\{([^}]+)\}/)?.[1];
  assert.ok(actionBar);
  assert.match(actionBar, /background:var\(--mica-flyout-sheen\),var\(--mica-flyout\)/);
  assert.doesNotMatch(actionBar, /opacity:/);
  const contrast = css.slice(css.lastIndexOf('@media (forced-colors: active)'));
  assert.match(contrast, /--mica-flyout:\s*Canvas;/);
  assert.match(contrast, /\.evaluation-action-bar \{\s*background: Canvas;/);
  assert.match(css, /\.setup-workspace\{padding-bottom:calc\(var\(--evaluation-actions-height,136px\) \+ 24px\)\}/);
  assert.match(css, /grid-template-areas:"evaluation panel" "recordings recordings"/);
  assert.match(css, /\[data-evaluation-open=false\]\[data-panel-open=true\]\{grid-template-areas:"evaluation panel" "recordings panel";grid-template-rows:min-content 1fr/);
  assert.match(css, /\[data-evaluation-open=true\]\[data-panel-open=false\]\{grid-template-areas:"evaluation panel" "evaluation recordings";grid-template-rows:min-content 1fr/);
  assert.match(css, /grid-template-areas:"evaluation" "panel" "recordings"/);
  assert.match(css, /@container\(max-width:680px\)/);
  assert.match(css, /\.recordings-card \.recording-workspace\{grid-template-columns:minmax\(0,1fr\);gap:20px\}/);
});

test('audio playback keeps one native playback track with no extra timeline or instructional text', () => {
  const html = renderToStaticMarkup(createElement(AudioPlayer, { src: '/test.wav', label: 'Saved recording' }));
  assert.match(html, /<audio[^>]*controls=""[^>]*preload="metadata"/);
  assert.equal((html.match(/<audio /g) ?? []).length, 1);
  assert.match(html, /aria-label="Saved recording"/);
  assert.doesNotMatch(html, /type="range"|<output|<small|Click or drag/);
});

test('unassessed inputs expose exact saved audio with honest role/language guidance and separated report actions', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const section = source.split('aria-label="Unassessed files"')[1].split('job.rubric === RUBRIC_VERSION')[0];
  assert.match(section, /<AudioPlayer src=\{`\/api\/clips\/\$\{clip.id\}\/audio`\}/);
  assert.match(section, /label=\{`Verify \$\{clip.file\}, \$\{clip.role\}/);
  assert.match(section, /Duration measures the length of the saved audio, not the presence of speech/);
  assert.match(section, /Role attribution is a model judgment and can be wrong/);
  assert.match(section, /it does not prove that the recording has no identifiable language/);
  assert.match(section, /Role \/ language verdict needs verification/);
  assert.match(section, /The saved assessment has not been changed/);
  assert.doesNotMatch(section, /Playback time starts at zero for this input window/);
  assert.match(source, /className="status-metadata"/);
  assert.match(source, /className="status-actions"/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-strip \{[^}]*margin-bottom: 24px/);
  assert.match(css, /\.primary, \.secondary, \.text-button \{[^}]*padding: 10px 16px; min-height: 44px/);
  assert.match(css, /\.evaluation-action-bar \.run-actions \{ display: contents; \}/);
  assert.match(css, /\.rubric-editor,[^}]*summary \{ padding: 10px 14px/);
  assert.match(css, /--mica-text: var\(--theme-text\)/);
});

test('test titles remain text links and status colors stay semantic rather than following the theme', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.test-name, \.test-ties \{ padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; \}/);
  const controls = css.match(/:is\((\.secondary,[^)]+)\) \{/);
  assert.ok(controls);
  assert.doesNotMatch(controls[1], /\.test-name|\.test-ties/);
  for (const selector of css.matchAll(/:is\(([^)]+)\):enabled:hover/g))
    assert.doesNotMatch(selector[1], /\.test-name|\.test-ties/);
  assert.match(css, /\.status-badge\.completed \{ background: #dcfce7; color: #166534; \}/);
  assert.match(css, /\.status-badge\.running \{ background: #fef3c7; color: #854d0e; \}/);
  assert.match(css, /\.status-badge\.queued \{ background: #fee2e2; color: #991b1b; \}/);
  assert.match(css, /\.status-badge, \.status-badge\.completed, \.status-badge\.running, \.status-badge\.queued,[^}]*background: Canvas; color: CanvasText/);
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /className=\{`status-badge \$\{h.status\}`\}/);
  assert.match(source, /className=\{`status-badge \$\{r.status\}`\}/);
});

test('expandable headings are plain full-row disclosures rather than nested button surfaces', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /summary \{ padding: 8px 13px; cursor: pointer; border: 0; border-radius: 0; background: none; box-shadow: none; \}/);
  assert.match(css, /\.clip-detail > summary \{ margin: 0 -16px; padding: 10px 16px; \}/);
  assert.doesNotMatch(css, /summary:hover/);
  assert.match(css, /summary:focus-visible[^{]*\{ outline-color: var\(--mica-focus\)/);
  assert.match(css, /\.setup-section > summary \{[^}]*text-align: left;[^}]*list-style: none;/);
  assert.match(css, /\.setup-section > summary small \{ margin-left: 0; \}/);
});

test('recording import uses one persistent drop area and consistent spacing instead of a duplicate folder button', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const section = source.split('<div className="recordings-content setup-section-content">')[1].split('</details>')[0];
  assert.doesNotMatch(section, /\+ Select folder|Select folder remains available/);
  assert.equal((section.match(/className="dropzone"/g) ?? []).length, 1);
  assert.ok(section.indexOf('className="dropzone"') < section.indexOf('{savedClips !== undefined ?'));
  assert.match(section, /folder\.current\.value = ''; folder\.current\.click\(\)/);
  assert.match(section, /type="file" multiple hidden/);
  assert.match(section, /data-has-inputs=\{savedClips !== undefined \|\| records\.length > 0\}/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.recordings-content\{display:flex;flex-direction:column;gap:16px\}/);
  assert.match(css, /\.recordings-intro\{display:grid;gap:8px\}/);
});

test('rubric and result disclosure rows share the content inset with markers inside the row', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /:is\(\.rubric-editor, \.voice-evidence, \.voice-coaching, \.voice-matrix\) summary \{ padding-inline: 0; list-style-position: inside; \}/);
  assert.doesNotMatch(css, /list-style-position: outside/);
});

test('language edits automatically update all draft inputs and Auto is formatted consistently without an apply button', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Apply to all recordings|applyLanguageToAll|Applying language hint/);
  assert.match(source, /onChange=\{e => updateLanguageAccent\(e\.target\.value\)\}/);
  const update = source.split('function updateLanguageAccent(language: string) {')[1].split('function updateRegion')[0];
  assert.match(update, /setProfile\(previous => withLanguageAccent\(previous, language\)\)/);
  assert.match(update, /setRecords\(previous => applyLanguageHint\(previous, language\)\)/);
  assert.match(update, /setSavedClips\(previous => previous === undefined \? undefined : applyLanguageHint\(previous, language\)\)/);
  assert.match(source, /value=\{displayLanguageHint\(profile\.language\)\}/);
  assert.match(source, /\{displayLanguageHint\(job\.profile\.language\)\}/);
  assert.match(source, /placeholder="Auto, British English/);
});

test('result views include the complete evaluation without a judge-language filter', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /languageFilter|setLanguageFilter|filteredJob|All languages \(not controlled\)|follows the language filter|Language filtering requires/);
  assert.match(source, /const summary = job \? summarize\(job\) : \[\]/);
  assert.match(source, /const voiceEvidence = job \? summarizeVoiceEvidence\(job\) : \[\]/);
  assert.match(source, /<VoiceImprovement job=\{job\} voices=\{voiceDirectorBriefs\(job\)\}/);
  assert.match(source, /\{job\.clips\.map\(c => <details className="clip-detail"/);
});

test('setup disclosures share compact vertical spacing and inset markers with aligned descriptions', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.setup-section\.card \{ padding: 0; \}/);
  assert.match(css, /\.setup-section > summary \{[^}]*grid-template-columns: 12px minmax\(0, 1fr\);[^}]*column-gap: 12px;[^}]*padding: 16px 24px;/);
  assert.match(css, /\.setup-section-content\{padding:0 24px 24px\}/);
  assert.match(css, /\.setup-section > summary > span, \.setup-section > summary small \{ grid-column: 2; min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.setup-section\[open\] > summary::before \{ transform: rotate\(90deg\); \}/);
});

test('recent evaluation statuses are compact muted text and dimension ratings have tighter spacing', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.history-item \.status-badge \{[^}]*padding: 0; border: 0; background: none; font-size: \.6875rem;[^}]*text-transform: none; letter-spacing: 0;/);
  assert.match(css, /\.history-item \.status-badge\.completed \{ color: #b8cdbf; \}/);
  assert.match(css, /\.history-item \.status-badge\.running \{ color: #d6c69d; \}/);
  assert.match(css, /\.history-item \.status-badge\.queued \{ color: #d2b2b2; \}/);
  assert.match(css, /\.history-item:enabled:hover \{ background: #ffffff14;/);
  assert.match(css, /\.voice-matrix \.matrix-ratings li \{ margin: 3px 0; font-size: var\(--text-caption\); line-height: 1.5; \}/);
});

test('all UI retry actions use the queue without blocking behind unrelated tests or falling back to legacy resume', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /api<Job>\(`\/api\/jobs\/\$\{source.id\}\/retry`/);
  assert.doesNotMatch(source, /\/resume/);
  assert.match(source, /enqueueRetry\(job, \{ retryUnassessed: true \}\)/);
  assert.match(source, /enqueueRetry\(job, \{ retryUnassessed: true, file \}\)/);
  assert.match(source, /enqueueRetry\(job, \{ retryAudioIssues: true \}\)/);
  assert.match(source, /enqueueRetry\(job, \{ retryUnassessed: false \}\)/);
  const blocker = source.match(/const retryBlocked = ([^;]+);/)?.[1];
  assert.ok(blocker);
  assert.doesNotMatch(blocker, /queue\?/);
  assert.match(blocker, /job\?\.status === 'running'.*job\?\.status === 'queued'/);
  assert.match(source, /Queued retries require the updated local server/);
  assert.match(source, /No retry was queued/);
});

test('folder sorting UI defaults to keeping originals and exposes unlimited inputs and output options', () => {
  const html = renderToStaticMarkup(createElement(FolderSorter, {
    busy: false, onAction: async () => {}, onPreview: async () => { throw new Error('Not called during render.'); },
    onApply: async () => { throw new Error('Not called during render.'); },
  }));
  assert.match(html, /one absolute path per line/);
  assert.match(html, /no folder-count limit/);
  assert.match(html, /0 directories entered/);
  assert.match(html, /with or without surrounding double quotes/);
  assert.match(html, /Spaces in paths are preserved/);
  assert.doesNotMatch(html, /up to 20/);
  assert.match(html, /value="keep" selected/);
  assert.match(html, /Output parent directory/);
  assert.match(html, /Output folder name format/);
  assert.match(html, /\{name\}_sorted/);
  assert.match(html, /Original folders and all their contents remain unchanged/);
  assert.match(html, /Replace originals/);
  assert.match(html, /Preview sorting/);
  assert.doesNotMatch(html, />Confirm replacement<\/button>/);
  assert.match(html, /class="card sorting-form"/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.sorting-form\{display:grid;gap:20px\}/);
  assert.match(css, /\.sorting-form>\.field-row\{[^}]*gap:20px;margin:0;/);
  assert.match(css, /\.sorting-form>button\{justify-self:start;margin-top:4px\}/);
  assert.match(css, /@media\(max-width:900px\)\{\.sorting-form>\.field-row\{grid-template-columns:1fr\}\}/);
});

test('every ranked other voice exports its overall score separately from its name and judge averages', () => {
  const value = job([
    clip({ voice: 'Winner' }), clip({ voice: 'Runner up' }), clip({ voice: 'Third voice' }),
  ], [5, 5]);
  const scores = [5, 5, 4, 3, 2, 1];
  value.results.forEach((result, index) => { result.assessment = assessment(scores[index]); });
  const table = csvTable(testTableCsv([value]));
  assert.ok(table.headers.every(header => !/\brole\b/i.test(header)));
  const [row] = table.rows;
  assert.equal(row['Other voice 1 name'], 'Runner up');
  assert.equal(row['Other voice 1 overall score'], '3.50');
  assert.equal(row['Other voice 1 - Judge 1 (deployment-0) average score'], '4.00');
  assert.equal(row['Other voice 1 - Judge 2 (deployment-1) average score'], '3.00');
  assert.equal(row['Other voice 2 name'], 'Third voice');
  assert.equal(row['Other voice 2 overall score'], '1.50');
  assert.equal(row['Other voice 2 - Judge 1 (deployment-0) average score'], '2.00');
  assert.equal(row['Other voice 2 - Judge 2 (deployment-1) average score'], '1.00');
});

test('judge columns align saved names and deployments across IDs and separate different deployments and duplicates', () => {
  const first = job([clip()], [4, 2]);
  const second = job([clip()], [5, 3]);
  second.judges[0].name = first.judges[0].name;
  second.judges[1].name = first.judges[0].name;
  second.judges[1].deployment = 'different-deployment';
  const duplicate = job([clip()], [4, 2]);
  duplicate.judges[1].name = duplicate.judges[0].name;
  duplicate.judges[1].deployment = duplicate.judges[0].deployment;
  const table = csvTable(testTableCsv([first, second, duplicate]));
  assert.equal(table.rows[0]['Best voice - Judge 1 (deployment-0) average score'], '4.00');
  assert.equal(table.rows[1]['Best voice - Judge 1 (deployment-0) average score'], '5.00');
  assert.equal(table.rows[1]['Best voice - Judge 1 (different-deployment) average score'], '3.00');
  assert.equal(table.rows[1]['Best voice - Judge 2 (deployment-1) average score'], '');
  assert.equal(table.rows[0]['Best voice - Judge 1 (deployment-0) #2 average score'], '');
  assert.equal(table.rows[2]['Best voice - Judge 1 (deployment-0) #2 average score'], '2.00');
});

test('per-judge report scores remain visible when missing panel evidence prevents an overall score', () => {
  const value = job([clip({ voice: 'Partial voice' })], [4, 2]);
  value.results[1].status = 'failed';
  const row = csvTable(testTableCsv([value])).rows[0];
  assert.equal(row['Best voice overall score'], 'Not assessed');
  assert.equal(row['Other voice 1 name'], 'Partial voice');
  assert.equal(row['Other voice 1 overall score'], 'Not assessed');
  assert.equal(row['Other voice 1 - Judge 1 (deployment-0) average score'], '4.00');
  assert.equal(row['Other voice 1 - Judge 2 (deployment-1) average score'], 'Not assessed');
});

test('CSV cell escaping preserves spreadsheet safety for existing reports and selected-test tables', () => {
  for (const value of ['=1+1', '+formula', '-formula', '@formula', '\tformula', '\rformula'])
    assert.equal(csvCell(value), `"${`'${value}`}"`);
  assert.equal(csvCell('comma, quote" and\nnewline'), '"comma, quote"" and\nnewline"');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(4.5), '"4.5"');
  const value = job([clip({ voice: '@unsafe' })], [4]);
  value.name = '=1+1';
  const csv = testTableCsv([value]);
  assert.ok(csv.includes(`"'=1+1"`));
  assert.ok(csv.includes(`"'@unsafe"`));
});

test('date filtering includes both full boundary days in local time', () => {
  const values = entries(4);
  values[0].createdAt = new Date(2026, 9, 22, 23, 59, 59).toISOString();
  values[1].createdAt = new Date(2026, 9, 23, 0, 0, 0).toISOString();
  values[2].createdAt = new Date(2026, 9, 23, 23, 59, 59).toISOString();
  values[3].createdAt = new Date(2026, 9, 24, 0, 0, 0).toISOString();
  const result = queryTests(values, { ...defaultTestFilters, dateFrom: '2026-10-23', dateTo: '2026-10-23' }, 1);
  assert.deepEqual(result.entries.map(entry => entry.id), ['2', '1']);
  assert.equal(queryTests(values, { ...defaultTestFilters, dateFrom: '2026-10-24', dateTo: '2026-10-22' }, 1).total, 0);
});

test('sorting is global and deterministic with unassessed scores always last', () => {
  const values = entries(65);
  assert.equal(queryTests(values, { ...defaultTestFilters, sort: 'oldest' }, 1).entries[0].id, '0');
  assert.equal(queryTests(values, { ...defaultTestFilters, sort: 'newest' }, 1).entries[0].id, '64');
  assert.equal(queryTests(values, { ...defaultTestFilters, sort: 'name-asc' }, 1).entries[0].name, 'Test 1');
  assert.equal(queryTests(values, { ...defaultTestFilters, sort: 'name-desc' }, 1).entries[0].name, 'Test 65');
  for (const sort of ['score-asc', 'score-desc'] as const) {
    const all = [1, 2, 3].flatMap(page => queryTests(values, { ...defaultTestFilters, sort }, page).entries);
    assert.equal(all.at(-1)!.bestScore, null);
    assert.equal(all[0].bestScore, sort === 'score-asc' ? 0.05 : 3.2);
  }
});

test('metadata validation rejects duplicate labels, unknown gender labels and assessment changes', () => {
  const label = { voice: 'Talent', gender: 'Female' };
  assert.deepEqual(testMetadataSchema.parse({ name: ' Renamed ', voiceLabels: [label] }), { name: 'Renamed', voiceLabels: [label] });
  for (const input of [
    { name: '', voiceLabels: [] },
    { name: 'Test', voiceLabels: [label, label] },
    { name: 'Test', voiceLabels: [{ voice: 'Talent', gender: 'inferred' }] },
    { name: 'Test', voiceLabels: [], results: [] },
  ]) assert.equal(testMetadataSchema.safeParse(input).success, false);
});
