import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testHistory, testNameMetadata, queryTests, defaultTestFilters, testMetadataSchema, type TestHistory } from '../shared/history.js';
import { clip, job } from './fixtures.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestLibrary } from '../src/TestLibrary.js';
import { ConfirmationDialog } from '../src/ConfirmationDialog.js';
import { TestActions } from '../src/TestActions.js';
import { readFileSync } from 'node:fs';
import { DatePicker, calendarDateKey, calendarDays, parseCalendarDate, shiftCalendarMonth } from '../src/DatePicker.js';
import { ThemePicker } from '../src/ThemePicker.js';
import { App } from '../src/App.js';
import { DEFAULT_THEME_COLOR, themeFamilies, themePalette, themePresets, validThemeColor } from '../src/theme.js';

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
  const overlays = css.match(/\.confirmation-dialog, \.test-action-menu, \.date-menu, \.theme-menu \{([^}]+)\}/)?.[1];
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
  assert.ok(html.includes('I have permission to send these audio inputs'));
  assert.ok(html.includes('AI opinion scores are not validated MOS'));
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
  const changedKeys = ['--theme-page', '--theme-glow', '--theme-surface-rgb', '--theme-panel-rgb', '--theme-sidebar-rgb', '--theme-inset-rgb', '--theme-selected', '--theme-header', '--theme-accent'];
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
    assert.ok((luminanceOf(rowHover) + .05) / (luminanceOf([41, 48, 57]) + .05) >= 4.5, `Hovered row text contrast for ${color}`);
    assert.ok((luminanceOf(surface) + .05) / (luminanceOf(rowHover) + .05) >= 1.3, `Visible row hover fill for ${color}`);
    const primaryHover = palette['--theme-accent-hover'].match(/\d+/g)!.map(Number);
    assert.ok(1.05 / (luminanceOf(primaryHover) + .05) >= 4.5, `White primary hover label contrast for ${color}`);
    const darkestDialogGlass = glass.map(channel => .06 * 255 + .94 * .82 * channel);
    assert.ok((luminanceOf(darkestDialogGlass) + .05) / (luminanceOf([41, 48, 57]) + .05) >= 4.5, `Dark foreground contrast over dimmed dialog glass for ${color}`);
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

test('compact list renders 30 rows, separate fields and one quick-action dropdown per test', () => {
  const values = entries(61);
  values[59].status = 'running';
  values[58].status = 'queued';
  values[60].bestVoices = ['Talent 60', 'Tied talent B', 'Tied talent C'].map(voice => ({ voice, role: 'speaker' }));
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(TestLibrary, {
    entries: values, busy: false, selectedIds: [], onSelectionChange: noop, onBulkAction: noop, onOpen: noop, onEdit: noop, onDelete: noop,
    onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.match(html, /<h1>Test Reports<\/h1>/);
  assert.ok(body);
  assert.equal((body.match(/<tr>/g) ?? []).length, 30);
  assert.equal((body.match(/class="secondary test-action-button"/g) ?? []).length, 30);
  assert.equal((body.match(/aria-haspopup="menu"/g) ?? []).length, 30);
  assert.equal((body.match(/popover="auto" role="menu"/g) ?? []).length, 30);
  assert.equal((body.match(/aria-label="Actions for /g) ?? []).length, 60);
  assert.equal(body.includes('test-action-select'), false);
  assert.equal((body.match(/aria-label="Select test /g) ?? []).length, 30);
  assert.equal((body.match(/type="checkbox"[^>]*disabled=""/g) ?? []).length, 2);
  assert.match(html, /aria-label="Select all eligible tests on this page"/);
  for (const field of ['Test name', 'Test time', 'Best voice', 'Best score', 'Language', 'Gender', 'Actions']) {
    assert.equal((body.match(new RegExp(`data-label="${field}"`, 'g')) ?? []).length, 30);
    assert.ok(html.includes(`<th scope="col">${field}</th>`));
  }
  assert.match(html, /\+2 tied/);
  assert.match(html, /title="Talent 60 \/ speaker, Tied talent B \/ speaker, Tied talent C \/ speaker"/);
  const toolbar = html.split('<div class="test-filters">')[1]?.split('<div class="test-list-meta">')[0];
  assert.ok(toolbar);
  assert.equal((toolbar.match(/<label/g) ?? []).length, 6);
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
    entries: values, busy: false, selectedIds: ['0', '60', '59', '58', 'deleted'],
    onSelectionChange: noop, onBulkAction: noop, onOpen: noop, onEdit: noop, onDelete: noop,
    onDownload: noop, onRegenerate: noop, onRefresh: noop,
  }));
  assert.match(html, /2 selected/);
  assert.match(html, /Delete selected/);
  assert.match(html, /Redo selected/);
  assert.match(html, /Clear selection/);
  assert.match(html, /aria-label="Select test Test 61"[^>]*checked=""/);
  assert.equal((html.match(/aria-label="Select test [^"]*"[^>]*checked=""/g) ?? []).length, 1);
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
    ['zh-Hant-TW Non-binary round 2', 'zh-Hant-TW', 'Other'],
  ]) assert.deepEqual(testNameMetadata(name), { languages: [language], genders: [gender] }, name);
  assert.deepEqual(testNameMetadata('Female audition'), { languages: [], genders: ['Female'] }, 'Female must not also match Male.');
  assert.deepEqual(testNameMetadata('Retail test'), { languages: [], genders: ['Unspecified'] });
  assert.deepEqual(testNameMetadata('en-GB en_GB Female Male'), { languages: ['en-GB'], genders: ['Female', 'Male'] });
  assert.deepEqual(testNameMetadata('NotFemale malevolent xx-YY'), { languages: [], genders: ['Unspecified'] });
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
