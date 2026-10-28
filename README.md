# Voices Selection

A local React + Node.js application for audio-only human auditions and TTS evaluation. Configure one or more Azure OpenAI Realtime deployments as independent listening judges, with no fixed panel-size limit. Each additional judge increases Azure usage and concurrent requests; deployment quotas still apply. No reference script is needed, and no transcript is requested or stored.

The interface uses a Mica-inspired tinted backdrop with frosted-glass cards, translucent controls and nested panels, subtle edge highlights and soft shadows. Shared theme tokens keep the edge lighting, borders, menus, confirmation dialogs, queue panels and opaque sticky table headings consistent across setup and results. Foreground layers (Actions menus, date calendars, customizable dropdown pickers, the color picker flyout and confirmation dialogs) share a diagonal sheen, bright edges, 12px backdrop blur and 155% saturation. Desktop flyouts use a 12%-opaque pastel tint so more underlying content shows through the blur rather than being hidden by a milky fill. Compact screens use a denser 66% tint where flyouts can overlap the dark sidebar, and modal dialogs use 82% to preserve text contrast over their dimmed backdrop. Foreground text stays fully opaque. Sticky table headings stay solid to prevent row text bleeding through. Native checkboxes are excluded from decorative control highlights so checked and mixed states do not get a pale stripe across their top edge. Dropdown pickers use the same rounded surface and selection/focus styling as Actions menus in browsers supporting customizable selects (`appearance: base-select`); other browsers retain accessible native pickers. Both date filters use app-themed calendars rather than browser date popups: enter `YYYY-MM-DD` directly or use the calendar button, month/year navigation, Today and Clear. Arrow keys navigate days, Home/End move within a week, Page Up/Down change months (Shift changes years), and Escape closes the calendar. Dates outside the other filter's boundary are disabled; invalid typed dates display an error without changing the applied filter. Browser/OS file and custom-color dialogs and audio controls remain native. Backdrop blur lets the chosen background tint show through while keeping text opaque and readable. This is a browser-rendered effect, not native Windows Mica or access to your desktop wallpaper. Browsers without backdrop-filter support use opaque surfaces; reduced-transparency and Windows high-contrast preferences remove the translucent treatment and foreground blur. Existing data directories and launcher filenames are unchanged by the display-name update.

Use **Color** in the workspace header to open **Color & shade**: five muted families (Sage, Lagoon, Sky, Iris and Rose), each with Mist, Soft and Deep shades. The square gradient swatches, selection ring and center dot show the current preset; the footer identifies its family and shade. Custom colors remain available, and previously saved hex colors are preserved even when they do not match a new preset. Changes apply immediately to the background, glass panels, sidebar, buttons, links, selection and focus highlights without changing evaluations or restarting the server. Button colors are darkened when needed to keep white-label contrast at least 4.5:1; warning/error/status colors retain their meanings. The chosen color is stored in this browser's local storage and restored after refresh. **Reset** restores Sage / Soft and removes the saved preference. Storage failures are displayed explicitly; the selected color can still be used for the current session. High-contrast system colors take priority over custom colors. If an already-open page still shows older styling, reload it after saving any in-progress draft.

Each color family has clearly separated light, medium and dark shades rather than near-white variations. The workspace header omits the preview badge, and the redundant bottom footer is removed to avoid unnecessary page overflow. Long setup forms and detailed reports still scroll normally so evaluation controls and safety notes remain accessible.

The desktop sidebar scales with the window width from 264px up to 440px, with proportional inner spacing, so recent tests and navigation are not squeezed on wide displays. The workspace uses the remaining width rather than staying inside a centered 1600px cap with large empty gutters. Existing 240px compact-desktop and 64px mobile navigation breakpoints remain unchanged.

Recent-evaluation row backgrounds share the navigation buttons' left and right edges. Their native scrollbar sits in the sidebar's right padding rather than narrowing the row highlights; the history heading remains fixed and the list remains independently scrollable.

Hover states use a solid accent fill and white labels for menus, buttons, calendars and dropdown options; destructive actions retain a distinct destructive fill. Color swatches gain a strong accent surround without losing their selected-state marker. Test rows use a stronger tint with an accent edge, and sidebar items gain a brighter fill and edge marker. Hover and persistent selection remain distinct. Hover label contrast stays at least 4.5:1 across custom colors, and system high-contrast mode uses Highlight/HighlightText instead.

Typography uses a shared 12-15 px scale for captions, metadata, controls and body text, with larger headings. History entries have larger, higher-contrast text and a wider desktop sidebar. The Recent Evaluations heading stays fixed while its entries scroll. Scrollable history, recording lists and tables use slim, muted-green scrollbars with transparent tracks; Windows high-contrast mode retains native scrollbar colors and sizing.

## Prepare a clean voice folder (standalone Windows tool)

Use [Sort-VoiceFolders.ps1](./Sort-VoiceFolders.ps1) in Windows PowerShell 5.1
or PowerShell 7. It needs no Node.js or Azure configuration. Select **one**
collection folder, for example `es-ES Male VTS`, not the parent of several collections.

Preview the copy plan, then run without `-WhatIf` to create it:

```powershell
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS' -WhatIf
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS'
```

The default output is a sibling folder named `es-ES Male VTS-sorted`:

```text
es-ES Male VTS-sorted
  039_01
    sample.wav
  11labs_v3_Dani
    sample.wav
```

To choose the main folder's exact name/location:

```powershell
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS' -OutputPath 'D:\Clean\es-ES Male VTS'
```

- Originals are never moved, edited, or deleted. Non-WAV files and empty folders
  are omitted **from the copy**, not removed from the source.
- Immediate folders under `TTS` or `NonTTS` are voice names. Other immediate
  collection folders are treated as voice names, supporting already-flat collections.
- All `.wav` files (case-insensitive) below each voice are copied directly into
  its voice folder, removing intermediate nesting such as `Waves\Callcenter`.
  This filters by extension; it does not validate or convert audio encoding.
- Identical voice names across groups are combined. Duplicate filenames within
  a voice receive `__2`, `__3`, etc. before the extension; no files are overwritten.
- Output must not already exist or overlap the source. Links/junctions and WAVs
  without an identifiable voice folder cause an explicit error before copying.
  OneDrive Files On-Demand folders/files are supported; copying online-only WAVs
  may download them and requires OneDrive to be running and connected.
  A copy-time error leaves an explicitly reported partial output; choose a new
  output path for a retry after resolving it.

Run the standalone tool's tests with:

```powershell
& .\tests\Sort-VoiceFolders.test.ps1
```

## Start

Requires Node.js 22.16+ and npm.

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:4310**. Use Edge or Chrome for folder selection and Web Audio decoding. For a production frontend build:

```powershell
npm run build
npm start
```

On this Windows machine you can also run `.\Start-VoiceLab.ps1`. The launcher uses Node.js from your PATH, or the app-specific portable runtime under `%LOCALAPPDATA%\VoiceQualityWorkbench\runtime` if one has been installed. It does not modify your system PATH.

The server listens only on loopback. Do not expose it as a network service: it is a single-user local application, not an authenticated multi-user service.

If an older version reports "Maximum call stack size exceeded" while preparing
an evaluation, update and restart the server before retrying. Audio-upload
validation now supports the full 120-second window without overflowing the
JavaScript call stack.

## Sharing and installing from GitHub

The source is distributed through the **public** [garhe/voices-selection repository](https://github.com/garhe/voices-selection). Anyone can download it without a collaborator invitation. This is not a hosted website or a GitHub Pages app: each person runs their own local frontend and Node.js backend, with the same evaluation and reporting features.

Install Git and Node.js 22.16+ (including npm), then run in PowerShell:

```powershell
git clone https://github.com/garhe/voices-selection.git
Set-Location voices-selection
npm ci
npm run dev
```

Open **http://127.0.0.1:4310** in Edge or Chrome. Leave the terminal running while using the app; **Ctrl+C** stops it. On Windows, the existing `Start-VoiceLab.ps1` launcher is also available after cloning. The historical launcher name and local data-directory name are retained for compatibility.

### Windows automatic startup and recovery

To run independently of VS Code/Copilot, stop the manually launched server, then run in PowerShell:

```powershell
.\Install-VoiceLabAutoStart.ps1
Start-ScheduledTask -TaskName 'Voices Selection'
```

This registers a **Voices Selection** task for the current Windows account, without storing a password or requesting administrator privileges. It starts at sign-in and runs while that account is signed in. A repeating one-minute trigger recovers the watchdog if it stops; concurrent task instances are ignored. The watchdog restarts the Node server ten seconds after any process exit. A Windows Job Object closes the child server if the watchdog is terminated, preventing orphan servers and port conflicts. The task has no execution time limit and is permitted on battery power. It does not depend on a terminal, browser tab, VS Code, or Copilot remaining open.

Keep this checkout and the Node runtime in their installed locations. Startup does not resume interrupted evaluations or authorize new Azure calls: existing interrupted/queued tests retain the normal explicit resume/start controls. Windows shutdown, sign-out and sleep still make the local app unavailable; sign-in/wake recovery depends on Windows Task Scheduler. This is process-exit recovery, not a guarantee against a running-but-unresponsive server or an underlying configuration error.

An already loaded app automatically retries failed initial loading, queue/history updates and active-test progress after a temporary disconnection. A visible reconnecting message clears after recovery; draft inputs and unsaved judging-panel edits are preserved. Polling requests time out after ten seconds, never overlap and never resubmit evaluations. If the browser initially loaded its own connection-error page while the server was down, refresh once after startup because the app's retry code has not loaded yet.

Logs are written to `%LOCALAPPDATA%\VoiceQualityWorkbench\logs`: `watchdog.log` records server starts/exits and each of the latest ten server launches has separate `server-*.stdout.log` and `server-*.stderr.log` files. Treat logs as local diagnostic data; review before sharing.

To stop automatic startup/recovery, disable the task before stopping it:

```powershell
Disable-ScheduledTask -TaskName 'Voices Selection'
Stop-ScheduledTask -TaskName 'Voices Selection'
```

Re-enable it with `Enable-ScheduledTask -TaskName 'Voices Selection'`, then `Start-ScheduledTask`. Remove it with `Unregister-ScheduledTask -TaskName 'Voices Selection' -Confirm:$false`. The installer also supports `-WhatIf` to preview registration.

Dependencies use the public npm registry, with pinned versions and integrity hashes in the lockfile. If your organization requires a package mirror, use its approved registry through `npm ci --registry=<approved-registry-url>` or `NPM_CONFIG_REGISTRY`. Do not disable TLS verification or commit registry authentication tokens.

### Each user configures their own Azure resource

- In **Your judging panel → Azure connection**, each Windows user enters their own endpoint/key and saves it locally with Windows DPAPI user encryption. The key is sent only to their local backend and to Azure for authentication, never to GitHub or other users.
- On macOS/Linux, UI key persistence is not supported; configure the Azure environment variables or a local `.env` using `.env.example` instead. A `.env` is plaintext, so restrict access and never share it.
- Each user supplies their own Azure Realtime deployment names and audio, and is responsible for their resource's permissions, quotas and usage charges. Credentials and deployments are not included with the project.
- Recordings, results, judge-panel settings and encrypted credentials remain in that user's local data directory. Audio is sent to their configured Azure resource when they start, queue or retry an evaluation; no separate permission checkbox is required. GitHub hosts the source, not their recordings or results.
- The repository excludes environment files (except the placeholder example), local data folders, credentials, audio files, generated reports, dependencies and build output. Never force-add these files, attach them to issues or commit them elsewhere. The source is public: anyone can read a file once it is pushed.

To update, wait for any evaluation to finish, stop the local server, then run:

```powershell
git pull --ff-only
npm ci
npm run dev
```

Updating source does not copy or overwrite another user's credentials or history. Do not expose the local server through port forwarding, a tunnel or a shared host. GitHub Actions runs automated tests and a build without Azure credentials or paid model requests.

## Azure configuration

### Configure in the interface (Windows)

In **Your judging panel → Azure connection**:

1. Paste the **Azure resource endpoint**, such as `https://your-resource.openai.azure.com`, or the **full Realtime endpoint** from Foundry's deployment Details page, such as `wss://your-resource.openai.azure.com/openai/v1/realtime?model=your-deployment`. The app normalizes this to the HTTPS resource origin when saving. Foundry project URLs and other API paths are not supported.
2. Paste **Key 1 or Key 2** into the password field.
3. Click **Save connection**. Changes apply immediately; no restart is necessary.
4. Enter each judge's actual deployment name and click **Save panel**.
5. Click **Test judge connections** for per-deployment success/error details.

All judges share one resource endpoint and key. Saved credentials take precedence over environment variables. Leaving the key blank preserves the configured key when keeping the same endpoint; changing resources requires a new key. Enter a new key to rotate it. **Remove saved connection** requires confirmation and restores environment-variable configuration if present. Active evaluations keep a snapshot of their original connection; new evaluations and retries use the current connection.

When the pasted URL contains `model=...`, the interface shows that deployment name as a hint. Enter it in one judge's deployment field; saving a connection never overwrites the judge panel. Each judge's own deployment name is used when opening its session, even if a different deployment appeared in the pasted URL.

Connection tests open a Realtime session and confirm acceptance of text output and 24 kHz audio input settings for the current deployment names. They send **no recordings or evaluation prompts** and generate no responses. They are not audio-scoring accuracy tests; Azure service billing policies still apply. Save endpoint/key edits before testing. Testing deployment-name edits does not save the panel.

The API key is sent from the password field to the loopback backend when saving, then cleared from the field. It is **never returned by the configuration API**, stored in browser storage, or included in job exports. On disk it is protected with **Windows DPAPI CurrentUser encryption**, tied to the Windows account, in the app's data directory. This is not protection against malware running as that same user. Moving the encrypted file to another account/machine may make it unreadable.

### Environment-variable alternative

Optionally copy `.env.example` to `.env`, set `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`, and restart. Environment variables work on other platforms too; UI key persistence currently requires Windows. Keep `.env` out of synced/shared folders when it contains a key.

Set actual deployment names in `JUDGE_DEPLOYMENTS` or edit and save the panel in the interface. Suggested candidates are `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`, **provided you have deployed them in your resource**. A model catalogue entry is not a deployment. Public Azure resource domains are supported; sovereign-cloud endpoints and Entra authentication are not implemented.

The adapter uses Azure's GA WebSocket endpoint `/openai/v1/realtime?model=<deployment>` with PCM16 mono 24 kHz input, text-only output modality, no transcription and no voice activity detection. Every excerpt/judge pair starts a new session. Evaluations register one `submit_voice_assessment` function with a JSON parameter schema and request that function in both session configuration and the response request. The preferred response is exactly one completed assessment call. Some Azure deployments acknowledge this configuration but still return an ordinary text message containing the JSON assessment, as verified with a synthetic recording.

For compatibility, the app also accepts one complete assessment JSON object in a single assistant text message. Harmless surrounding formatting (such as a code fence or `JSON response:` label) can be removed using brace/string-aware extraction, not a greedy regular expression. Completed reasoning items are treated as protocol metadata, not assessments. A single valid function call may be accompanied by empty text messages, an identical fully schema-validated JSON assessment, or a narrowly allowed acknowledgement/intent preamble such as `Understood.` or `I'll focus on the agent's audible delivery and listening comfort, not the content details.` Acknowledgements are limited to fixed boilerplate; an intent preamble must be one short future-tense sentence, without numbers, rating language, asserted findings or JSON. Allowed preambles are ignored and marked as `function_call_with_preamble` in the report and exports. All accepted scores and evidence still come exclusively from the validated function arguments. A preamble without a valid function call is never an assessment.

Conflicting structured assessments, unrecognized or potentially conflicting commentary, audio output, incomplete JSON and invalid calls are not accepted. Duplicate JSON is compared before score normalization, so differences in inactive dimensions cannot be hidden. Both response routes undergo the same complete schema, score-range and requested-role validation. The app never invents fields/scores, repairs malformed JSON or selects between conflicting assessments. Output logs record the compatibility path but do not retain discarded preamble text.

If a completed response fails assessment validation, the app requests **one automatic format retry** in the same audio session, with reinforced function-only instructions and without uploading the audio again. Rejected output items with service-assigned IDs are deleted from the conversation before retrying, preserving the audio while avoiding unresolved function calls or reuse of rejected scores. This can incur additional Azure usage, is disclosed in the evaluation usage notice, and shares the original 180-second timeout. Cancellation still stops the request. If that session still cannot produce a valid assessment, the same bounded fresh-session recovery described below is used; exhausted recovery fails explicitly. Service/connection errors are not automatically retried. Rejection logs record only output item types, not response text or function arguments. The returned `responseFormat` (`function_call`, `json_text`, or `wrapped_json_text`) is saved, displayed with the judge's result and included in CSV/JSON exports so compatibility handling is visible.

### Missing-audio recovery and diagnostics

Some deployments intermittently return valid assessments claiming that only text or no audio was supplied, even when other judges score the same input. The adapter explicitly distinguishes text-only **output** from waveform **input** in its transport instructions. An unassessable verdict containing an explicit missing-audio claim, a response whose usage reports zero input audio tokens, or exhausted same-session format validation triggers **at most one fresh-session retry with the exact original PCM re-uploaded**. Each session still allows one format retry, but all sessions share a single 180-second deadline and cancellation signal. There are at most two sessions/four response requests, not an unlimited retry loop. These bounded retries incur Azure usage and are disclosed in the evaluation usage notice.

This is delivery recovery, not a request to raise scores: genuine silence, unsupported language, unclear roles and role-not-present verdicts do not by themselves trigger this retry. If the fresh response again claims missing audio, it stays unassessable and the report flags the unresolved issue. If Azure again reports zero input audio tokens, the assessment fails explicitly and no scores are accepted. Missing usage telemetry is **unknown**, never assumed to be zero. Service errors and format failures after both sessions remain explicit failures.

Each new judge result stores `audioDiagnostics`: a SHA-256 hash and byte count of the submitted PCM, per-session uploaded bytes/commit acknowledgement/reported model, and per-response audio/text token counts, output token count, output item types and validation outcome. It records whether recovery was unnecessary, recovered the delivery claim, or remained unresolved. Diagnostics survive failures as well as successes. They do not include credentials, raw model text, reasoning text or transcripts. An audio-token count confirms service accounting, not that a model perceived the voice correctly. Historical results have no retroactive telemetry.

After an evaluation stops, **Retry audio-input issues** re-evaluates only completed verdicts containing explicit missing-audio claims, including historical ones. It requires available saved PCM; clicking Retry sends audio to Azure with additional usage, without a separate permission checkbox. It does not silently retry other completed verdicts or unrelated failures. **Retry incomplete judges** retains its existing behavior. Both preserve replaced verdicts in `previousEvaluations` before clearing stale scores and collecting a new result. Inspect **Audio-delivery diagnostics** and **Previous evaluation audit history** in the per-recording judge details. JSON and per-assessment CSV exports contain the diagnostics and full previous evaluations; the scoring-gap summaries flag missing-audio claims separately from ordinary voice-performance limitations.

Forced function calling improves formatting reliability but is not a guarantee that a model/service always succeeds, understands the audio, writes English, or provides assessable scores. Realtime's documented function definition does not expose strict Structured Outputs, so the application still validates every returned argument. Use deployments that support the required function configuration. **Test judge connections** now checks that configuration without sending audio or requesting an assessment; it does not prove successful generation or rating accuracy. Completed historical results remain unchanged; new evaluations and explicit incomplete-judge retries use function responses.

## Workflow

1. Enter a required **Test name** (up to 120 characters) and choose **Voice Selection** or **TTS evaluation**. Required fields use an inline `*`; native required-field validation remains enabled. Choose a saved **Evaluation guide / rubric** or expand **Edit rubric** to customize its criteria and stage weights.
2. Choose single speaker, agent only, or both, scored separately. New setups default to **Agent only**, matching the default call-center guide. Choosing **Single speaker** or **Both, scored separately** substitutes the matching default guide unless the per-test guide was manually edited. Customer-only is no longer offered for new selections; saved customer-only tests remain compatible.
3. **Language / accent** automatically fills from a single locale code in the test name (for example, `ko-KR Female VTS` supplies `ko-KR`, and `thTH Male Cartesia` supplies `th-TH`). No locale, or multiple locales, uses `auto` rather than guessing. You can override the field manually, such as `British English` or `Italian for Italy`; changing the test name recalculates it. An explicit value supplies both the listening hint and the accent-fit target; `auto` detects language without scoring accent fit. The required **Target vocal style or test guide** defaults to the detailed call-center agent-only instructions, emphasizing natural, authentic delivery and specific evidence while excluding the customer. It remains editable. An empty or whitespace-only guide blocks new evaluations in both the setup screen and API, with a reminder to complete it. Saved results remain unchanged.

Every judge receives an explicit checklist of requested scores, including **Audio quality** in both stages (by default included in TTS preference scores and diagnostic only for human auditions; custom rubrics control its stage weights). Clean audio and an absence of defects are positive evidence for a rating, not grounds for calling the dimension inapplicable. Each submitted dimension requires a non-empty explanation, including inactive or genuinely unassessable dimensions. Empty placeholders and an audio-quality null justified as "not applicable" for otherwise assessable speech are rejected; the existing bounded retry supplies the specific validation failure and asks the same judge to assess the audio independently again. Retry/session limits do not increase. Genuine uncertainty remains null with an explanation; no missing score is filled, averaged away or fabricated. Saved assessments remain readable and are never rewritten by this validation.

A guide does not guarantee an assessable result: a judge may still report insufficient speech, an unsupported or unclear language, ambiguous speaker roles, or missing evidence for an active dimension. Every configured judge must supply eligible ratings for a recording to enter the full-panel preference average. Check that recording's judge limitations and role evidence; a completed assessment can legitimately be unassessable or partial.
4. Configure one or more judges. They use the same rubric and never see candidate names, filenames, other judges' scores or previous recordings.
5. Drop a parent folder onto **Bring your recordings** to import without the folder picker's browser trust prompt, or use **Select folder** (the browser-required picker prompt cannot be disabled). Immediate subfolders identify voices/candidates. Files deeper inside a voice folder remain grouped with that voice. Direct children of the parent are labelled `Ungrouped`.
6. Leave **Speaker selection** on **Automatic** (the default). No timestamps or per-recording confirmations are required. Each judge listens to the conversation, infers roles from content, and assesses only the selected role.
7. Select **Add to queue** to schedule the test and prepare another, or **Start evaluation** to run immediately when no test is running or waiting. These actions send audio to the configured Azure resource and incur usage; no separate permission confirmation is required.
8. Inspect per-judge evidence, separate voice/role summaries and technical diagnostics. Export the complete job as JSON or per-judge assessments as CSV.

### Automatic test queue

- **Add to queue** uploads and saves the configured audio inputs and snapshots the test name, profile, language/accent, guide and judging panel. The setup clears the name and audio selection for the next test, restores the default guide and retains stage/scope/panel settings. No additional permission checkbox is required.
- Tests run automatically **one at a time in queue order**; judges within a test retain their existing parallel behavior. Later changes to the setup or saved panel do not modify waiting tests. Waiting tests use the configured Azure connection when they start, and normal evaluation/retry charges apply.
- A failed judge or interrupted test remains in history with its error; the queue continues to the next test. Connection or persistence failures that prevent a queued test from starting pause the queue and display an error rather than dropping the test.
- The compact **Test queue** bar is visible in setup and results. Expand **Waiting tests** to see their order or cancel one. **Pause queue** prevents subsequent tests from starting without stopping the current test; **Cancel running test** stops that test and allows the next one to run unless the queue is paused.
- The queue is stored on the backend, so closing the browser does not stop it. **Keep the local server running.** After a server restart, the formerly running test is marked interrupted and waiting tests remain saved but paused. Use **Start queue** to continue with normal Azure usage and no additional confirmation; completed tests are not rerun automatically.
- Running and queued tests cannot be renamed or deleted. Cancel a waiting test first to edit its metadata, delete it, or use its saved audio in a new draft. Incomplete-result retries cannot jump ahead of a waiting queue.

### Reuse, edit and delete evaluations

- **02 Test Reports** opens **Test Reports**, with separate columns for **Test name**, **Test time**, **Best voice**, **Best score**, **Language**, **Gender** and **Actions**. Compact desktop rows show status and excerpt count beneath the name; the excerpt tooltip identifies the stage. Long names are truncated with full-name tooltips. The leading tied voice is shown with a **+N tied** link to the full results. Unscored tests show **Not assessed**, and running-test scores are provisional. Scores are uncalibrated AI opinions, not like-for-like comparisons across different tests.
- Choose **30, 40 or 50 tests per page** (default 30) beside the previous/next buttons and page selector. Changing the page size returns to page 1 without clearing filters or selected tests; the choice remains when returning from details. Search covers test names, voice names, languages and IDs. Language, gender and inclusive local-date filters combine before pagination. Sort by test time, test name or best score; unassessed scores stay last. **Language and gender are extracted only from the test name**, not audio, listening hints, voice folders or saved voice labels. For example, `ko-KR Female VTS` yields `ko-KR` and `Female`, while `thTH Male Cartesia` yields `th-TH` and `Male`. Hyphenated/underscored locale tags, optional script subtags and compact language/region codes such as `thTH` are supported. Gender tokens are matched as complete words, so Female never also matches Male. Missing metadata shows **Not specified** / **Unspecified**, rather than guessing. Filter/page selections remain when returning from details; the sidebar shows the eight most recent evaluations.
- The test list is optimized for desktop web resolutions. Search, language, gender, From date, To date and sorting share a compact toolbar with aligned, equal-height controls. Date fields stay inline rather than expanding a full-width section. The table has a bounded scrolling area with opaque sticky column headings so scrolled rows do not show through, and pagination below. At narrower window sizes it retains its columns with scrolling inside the table, rather than switching to mobile cards.
- Select one or more tests with the row checkboxes. The header checkbox selects or clears eligible tests on the current page; selection is retained across pages and filters. **Delete selected** permanently removes the selected tests/results but keeps shared audio. **Redo selected** creates new tests with the originals' saved audio, guide, language and judging panels and adds them to the automatic queue; original tests and ratings are unchanged. Redo retains its selected-test confirmation and usage notice, without an extra Azure permission checkbox. Running/queued tests cannot be selected. Bulk results show success counts and an error for each failed test; successful selections clear while failed eligible selections remain available to retry.
- Select tests, then click **Export selected report** beside **Delete selected**, **Redo selected** and **Clear selection** above the table. Each click downloads **one CSV file**, with **one row per selected test**, including selections on other pages or hidden by filters. The first columns are **Test name, Test time, Locale, Gender**. Repeated **Best voice** and **Other voice 1, Other voice 2, ...** groups each contain separate **name**, **overall score**, and **average score per judge** columns; no Role columns are exported. Every other voice has its own overall-score column, not just per-judge scores. Tied winners receive separate best-voice groups; other voices are ordered by score, descending, with unassessed voices last. The number of groups covers every selected test, and unused groups are blank. Overall scores use the detailed report's full-panel preference calculation; separate speaker-role assessments remain separate groups even though their roles are not displayed. Per-judge averages use that judge's eligible recordings independently, preserving the existing region-duration and equal-recording weighting; a judge can have a score even when another judge's missing evidence prevents an overall score. Missing scores show **Not assessed**, never zero. Judge columns are aligned across tests by saved name and deployment (identical duplicate judges receive numbered columns); a judge absent from a test has blank cells. Times use the saved ISO timestamp and locale/gender come from the test name. CSVs use UTF-8 with a BOM, quoted fields and spreadsheet-formula escaping. Selecting/deselecting tests does not download anything. If any selected test cannot be loaded, an error is shown instead of downloading a partial report. No Azure calls or reassessments are made.
- Single-test deletion and bulk Delete/Redo use compact, centered modal confirmations without scrolling the page to the top. The confirmation lists all selected tests, including selections on other pages or hidden by filters. Focus stays inside the modal, the safe cancellation action is initially focused, and Escape cancels unless a request is in progress.
- Click a test name for complete results and use **Back to all tests** to return. Each row's **Actions** button opens a compact app-styled dropdown with rounded corners, themed hover/focus states and grouped actions: **Edit test details**, **Rerun reports**, report downloads and **Delete test...**. The menu floats above the table without clipping, fits inside the viewport, and closes after selection, on outside click, Escape, table/page scrolling or resizing. Arrow keys and Home/End move through enabled actions; Tab returns to normal navigation. There is no intermediate full-page actions dialog. Download complete JSON, assessment CSV, voice-summary CSV or next-take guidance CSV without opening details. Actions can be repeated; edit/delete are disabled for running or queued tests, and deletion still requires a separate centered confirmation.
- **Edit** (or **Edit test details** inside a report) changes the saved test name, with a live preview of the extracted language and gender. Rename the test to correct these fields; filters and columns update immediately. Existing per-voice labels are preserved but do not supply the list's Gender field. Test names persist across restarts; timestamps, audio and ratings remain unchanged. Running tests cannot be edited.
- **Rerun reports** recompiles current summaries, evidence and director briefs locally from saved assessments and opens the report. It makes no Azure calls, does not re-listen or invent missing director cases, and leaves saved assessments unchanged. Use the download actions to save regenerated reports. For new judgments, use **Edit inputs** and start a new evaluation instead.
- From Results, click **Evaluation setup** to open a fresh test draft. It retains the viewed evaluation's stage, scope, speaker mode and judging panel, restores the default test guide and resets language/accent to `auto` until the next test name supplies a locale. It clears the test name, recordings and saved-input reuse. Enter a name and select or drop the next folder. Saved results and the original connection settings stay unchanged. Clicking the already-active Setup tab does not discard an in-progress draft. You can prepare and queue a new test while another runs.
- Open a saved report and choose **Edit inputs** to explicitly copy its name, profile, judges and available saved audio into an editable setup draft. Starting it creates a new ID and new results; the original evaluation is never overwritten. No separate audio permission checkbox is required. When older settings used separate language and accent values, the accent description becomes the combined value if supplied, otherwise the language is used. Review that combined value before starting; this does not change the saved report.
- Saved audio consists of the exact processed excerpts/windows used previously, not full original recordings. Ranges, channels and speaker-selection mode remain unchanged. Edit voice names and language hints, include/exclude inputs, or change the evaluation stage, target and judges. The selected scope must match the included roles and retain all required roles for each recording. Select a folder to replace the saved inputs and change ranges or speaker mode. Missing audio is reported explicitly.
- **Select folder** is always a directory picker, including after returning from Results. Dropping a folder onto the recordings section is the prompt-free alternative. A valid import replaces all draft recordings or reused saved inputs, rather than appending to them, and clears stale previews. Selecting the same folder again reloads it. Canceling the picker keeps the current selection; invalid selections report an error without replacing it. No original files or saved evaluations are overwritten.
- **Delete** is available in the list and report details and requires confirmation. It permanently removes that evaluation and its results, not the current draft or saved audio files (which may be reused by other evaluations). Running evaluations cannot be deleted; cancel and wait first. There is no bulk-delete action.

All judge-authored comments are required to be in **English**, regardless of the recording's language or target-style text: dimension reasons, observations, limitations and speaker-role evidence. The listening hint describes the input audio, not the report language. The detected-language field still identifies the original audio language, using its English name (for example, **Italian**). Audio is not translated or transcribed. This instruction applies to new assessments and explicitly retried incomplete assessments; previously saved comments and user-entered names/text are not automatically translated.

### One language/accent setting and accent fit

The single evaluation **Language / accent** field applies to all stages (Voice Selection and TTS), speaker-selection modes, roles and judges. For example, `British English` supplies both the listening-language hint and the accent-fit target; a longer value can specify acceptable regional variation. Use at most 500 characters. `auto` (case-insensitive) requests language detection and leaves accent fit inactive. There is no separate target-market input in Setup.

A recording or saved input set to `auto` inherits the evaluation listening hint; an explicit per-input hint overrides listening context only, not the evaluation-wide accent target. Editing the test name automatically copies its detected locale (or `auto` for no/ambiguous locale) to every loaded recording or saved audio input, including excluded inputs, replacing previous listening overrides in the draft. New imports use the current evaluation language/accent. Individual overrides remain editable afterwards. For manual evaluation-field changes, **Apply to all recordings** copies that value to all inputs. Neither action starts an evaluation, calls Azure, modifies original audio, or changes past reports.

The Gender column also accepts standalone `M` / `F` tokens in test names (case-insensitive), alongside `Male` / `Female`. For example, `en-GB F VTS` yields `Female`; `thTH M Cartesia` yields `Male`. Letters inside other words or codes are not gender tokens.

Hint resolution is also enforced by the backend, including API-created evaluations and saved-audio reuse. Each job snapshots the effective per-input hint without changing shared source metadata. Reports show the evaluation and per-input hints. A hint is context, not ground truth: judges still report the language actually heard.

An explicit combined value activates the separate **Target-market accent fit** (`accentFit`) score in audition and TTS, independently of target delivery style. It has the same weight as each other active dimension. Judges use the stated accent criteria and acceptable variation, not an assumed universal accent. A value such as `English` alone may be too broad for a reliable accent-match judgment; be specific when accent fit matters.

Internally, the combined setup value populates both `profile.language` and `profile.targetMarket` (with an empty market for `auto`), so reports and exports retain the actual listening and scoring configuration. Existing saved reports and API clients using separate fields retain their original semantics; changing the setup controls does not retroactively enable accent scoring in an older evaluation. The rubric remains `audio-only-v4`.

Judges compare audible pronunciation, vowel/consonant patterns, stress and intonation with the explicit target. They must not infer nationality, ethnicity, residence, identity or native-speaker status, impose a universally preferred accent, or penalize the same market mismatch again in other dimensions. Actual intelligibility remains an articulation concern. A vague target or insufficient evidence requires a null rating and an explanation, not a fabricated match; as with any missing active dimension, this prevents an overall preference score. Without a target market/accent, `accentFit` is null and excluded from preference.

Accent-fit scores and original reasons flow into recording-level results, active-dimension summaries, judge evidence, the comments matrix, improvement guidance and exports. All four CSV exports include the evaluation language hint and target market; assessment CSV also includes the effective input hint and the accent-fit column. JSON preserves these in the profile, clips and assessments. Accent coaching uses the explicit target and saved evidence, not the reference voice's identity as a standard. These are uncalibrated model opinions, not certification of suitability for a market; confirm with listeners familiar with that market.

Target presence is stated explicitly in the session instructions, the assessment-function schema and the per-response instructions. A supplied target is evaluation data to use, not a command to execute or a description requiring further confirmation. Judges are instructed not to claim it is absent, and that example null scores are placeholders rather than default ratings. Genuine assessment limitations may still produce null scores; the app never invents a missing rating or changes existing saved results.

### Voice issues and judge evidence

Results include **Voice issues & judge evidence**, grouped separately by voice, speaker role and judge. This is a local compilation of existing recording-level comments, not a new LLM synthesis or a claim that every observation is a defect. It makes no additional Azure calls.

- Full-panel coverage and each individual judge's scored-file count are shown separately.
- Scoring gaps identify failed/pending assessments, uncertain/absent roles, unsupported languages and missing active dimensions. Missing target-style ratings explicitly show when the test supplied a target.
- Original observations, limitations and per-dimension reasons remain available, with source recording paths. Identical comments (after whitespace normalization) are grouped and counted by distinct recording, not by the number of audio windows. Paraphrases are not merged, and contradictory judges are not presented as agreeing.
- Dimension averages reuse the existing recording/window aggregation. Audition audio quality remains diagnostic-only. Neither missing ratings nor missing judges are silently dropped from the overall preference calculation.
- The view follows the selected language filter. **Export voice summaries** downloads an evidence CSV; **Export JSON** includes `voiceEvidence`. Both export the complete evaluation, independently of the display filter. Existing per-assessment CSV exports are unchanged.

**Judge comments matrix** adds a side-by-side report: one row per voice/role and one column per configured judge, alongside the full-panel preference and eligible-file count. Each judge cell shows its own preference and scored-file coverage, original overall comments, limitations, scoring gaps, dimension averages and expandable original reasons with source filenames. Single-judge averages use the same window/file weighting as the panel, but only that judge's eligible recordings; they are not panel scores. Missing scores remain **Not assessed**, and audition recording quality remains diagnostic-only.

The first two overall comments are displayed by distinct-recording frequency, then alphabetically; all remaining comments can be expanded. This is an extractive saved-evidence report: it does not infer positive/negative labels, turn limitations into cons, merge contradictory opinions, or generate a new overall verdict. Comments can include completed assessments from recordings excluded from the preference score, so inspect the source files and coverage before comparing voices. It makes no additional Azure calls.

**Export matrix CSV** exports the complete evaluation as voice/role rows and judge columns. Each multiline judge cell contains all saved overall comments, limitations, gaps, dimension ratings and reasons, with recording sources, not just the two initially displayed comments. The matrix follows the language filter onscreen; exports do not. JSON `voiceEvidence` also includes full-panel and individual-judge preference scores.

Previously saved runs gain these evidence summaries immediately on reopening; their original scores and comments are not rewritten or translated.

**Voice director: your next take** presents a talent-facing rehearsal brief for each voice and role. New evaluations ask each judge for up to three recording-specific cases: an exact listening cue within the selected excerpt, what was heard, one executable adjustment, and an audible pass check. Cases identify the recording filename and selected excerpt boundaries (seconds in the original file); cues locate moments within that excerpt, not invented timestamps or transcripts. Priorities use the voice's own supported cases and ratings below 4, not merely its gap to a higher-ranked voice, so even the leading performer can receive a specific local adjustment. Only full-panel eligible recordings and active dimensions contribute. Older results remain readable: available recording-specific feedback is shown, but missing exact directions are explicitly labeled; run a new evaluation to obtain cases. No extra Azure calls are made when opening a saved brief. The same cases, summary, rehearsal plan and checklist appear on screen and in text, CSV and JSON guidance exports. Briefs retain up to two supported strengths and at most three focus areas, along with the supplied delivery style and market/accent target. Directions focus on vocal sound and listening comfort, not rewriting the script, changing accent indiscriminately, exaggerating emotion or copying another performer.

The brief is generated locally from saved results using dimension-specific directing templates, not an additional LLM call or a new listening diagnosis. Existing matched-recording comparisons still select priorities internally: the highest-scoring same-role voice is used on shared full-panel eligible recordings, with matching unambiguous filenames and reported language sets. The three largest positive active-dimension gaps select the rehearsal focus; qualities with an own-voice dimension average of at least 4/5 can become **Keep doing** notes. Matching filenames do not verify matching scripts. Audition audio quality is not a performance priority; TTS audio quality and supplied delivery/market targets follow the active rubric.

The talent-facing section contains no judge names, deployments, reference-voice names, comparison scores, source-recording links or raw evidence. Internal comparison warnings are replaced by plain-language notes about incomplete feedback, provisional reviews or earlier criteria. When no specific change is supported, the brief prescribes consistency rather than inventing a deficit; insufficient comparable feedback produces no targeted directions or claimed strengths. General exercises are suggestions to audition, not guaranteed improvements.

**Download next-take brief** saves one performer's standalone plain-text brief, suitable to hand directly to that talent without other voices or audit metadata. **Export improvement CSV** exports the same director summaries, directions, practice plans and checklists for the complete evaluation, without judge/reference evidence or comparison scores. **Export JSON** uses this talent-facing shape under `improvementGuidance`; the complete evaluation JSON still contains original assessments and audit evidence elsewhere. Other evidence sections and exports are unchanged. The on-screen briefs follow the language filter; aggregate exports use the full evaluation. No additional Azure calls are made, and saved assessments remain unchanged.

Test names appear in history and the results heading, persist across restarts and retries, and are included in JSON exports and every CSV assessment row alongside the evaluation ID and timestamp. Names need not be unique: the ID identifies the exact run. The name is not sent to the judges. Existing runs without a name remain readable as **Untitled evaluation**. Imported audio and the new-test name draft are not restored after a browser refresh.

If **Start evaluation** is greyed out, the **Before you can start** checklist beside it lists the exact missing requirements: test name, guide, Azure configuration, valid judge panel and audio selection/input limit. Automatic mode never requires per-file review. A running operation/evaluation temporarily blocks a new start. Starting, queuing and retrying send audio to Azure without an additional permission checkbox; usage and local-storage notices remain visible.

### Automatic role-focused listening

Judges use what speakers say to distinguish the service-providing agent from the help-seeking customer. They are instructed not to infer roles from speaking order, pitch, accent, gender or perceived identity. Every role assessment includes a status (**identified**, **not_present**, or **uncertain**) and brief content-based evidence, without a transcript. If content/language is insufficient, several people share a role, or overlap prevents reliable attribution, the judge must flag uncertainty instead of guessing.

This is **not precise timed diarization or acoustic source separation**. Saved audio still contains the conversation, not an extracted agent/customer track. The model must attend to the target role; real-world attribution and rating accuracy require validation with representative recordings and human reviewers.

The complete recording is used, not just its first 120 seconds. Longer recordings are automatically partitioned into equal consecutive windows of at most 120 seconds. Windows cover all audio without gaps or overlap, and boundary cuts are not intended to be rated as original artifacts. Each window is judged independently, so missing conversational context can cause an uncertain result. **Both** creates separate agent/customer assessments of the same conversation windows, never a combined score. No extra Azure service is needed.

Import up to 200 audio files (100 MB per file), each at least 0.5 seconds long. Use at most **200 role/audio inputs** per evaluation, before multiplying by judge count: a 5-minute recording becomes three windows, or six inputs when evaluating both roles. The pre-run count is a lower bound until all file durations are known. Preparation reports an explicit error if the complete recordings exceed the cap; it never silently truncates them. Formats depend on the browser's decoder; PCM WAV is the most portable.

### Optional manual selection

For known speaker channels or exact user-controlled excerpts, choose **Advanced — manual speaker ranges / channels**. This mode retains the existing per-recording range confirmation. One person per stereo channel can be selected by channel; mono conversations require manual turn selection. The first range defaults to the first 120 seconds or the full recording if shorter; it is only an editable starting point. Multiple same-role ranges must not overlap. The checklist and **Review next recording** button apply only to this mode.

Manual mode sends only selected excerpts without surrounding conversation. Neither mode checks against an intended script or stores a transcription. Target-style fit concerns vocal persona and delivery only. Semantic correctness, script logic and task completion are excluded from scores; conversation-level turn-taking is not independently assessed.

## Editable evaluation guides and rubrics

Setup's **Evaluation guide / rubric** selector includes the original **Default voice-persona rubric** and app-wide saved presets. Expand **Edit rubric** to change the name, instructions, seven dimension labels/descriptions and enabled dimensions. Each border title has its Enable checkbox immediately before it. Titles appear as normal text; click one to rename it, then press Enter or click away to finish, or Escape to cancel. Names capitalize their first character when you finish editing.

Compact **Voice Selection** and **TTS** checkboxes control stage inclusion. Checked dimensions contribute equally (stored weight `1`); unchecked stages exclude that dimension (stored weight `0`). Choosing an older numeric-weight preset or using **Edit inputs** converts only the new editable draft to these yes/no settings. Original presets are unchanged until explicitly saved; existing/queued tests, retries and redos retain their exact original snapshots and weights. Disabled dimensions retain their stage selections so they can be enabled again.

The built-in default is read-only, so name an edited copy and choose **Save as new preset**. Custom presets support **Save changes**, **Delete preset** and **Refresh presets**. Revision checks prevent overwriting a newer edit from another browser. Switching away from unsaved rubric changes requires confirmation.

Presets are saved in `rubrics.json` in the application's data directory, not browser storage, and are available in other browsers connected to the same local app. Every fresh test, including the next draft after adding a test to the queue, starts with the built-in default rubric and its scope-matching guide. It is already saved; no preset save is needed. **Unsaved changes** appears only when the rubric values differ from the selected saved preset, and clears when those edits are reverted. Saving a preset does not select it as a new global default. **Edit inputs** still reuses the saved test's rubric snapshot. Unsaved rubric edits can be used in a test, but are not added to the reusable preset library until saved.

The original agent-only conversation test guide is retained. Selecting **Single speaker** automatically substitutes a one-speaker guide, without customer/agent exclusions. Selecting **Both, scored separately** uses a dedicated guide that evaluates agent and customer voices independently, without combining scores or letting one speaker influence the other's ratings. Switching back to **Agent only** restores the agent-only conversation default. Each rubric can edit all three default guides; older presets receive the built-in both-speaker guide when loaded. Manually edited per-test guide text is preserved when changing scope or rubric. New drafts and queue resets use the default guide matching their scope and rubric; saved evaluations are unchanged.

New tests store the complete rubric definition in `profile.rubric`. Queued tests, retries and redos use this snapshot even after the preset changes or is deleted. Preset ID/revision identifies its source; the embedded snapshot is authoritative, including any unsaved edits used for that test. Reports display saved criteria, labels and stage weights, JSON retains the full snapshot and every CSV report includes preset metadata and the snapshot. Legacy tests without a snapshot keep the built-in scoring behavior; historical results are not rewritten.

Every judge receives the selected instructions, dimension descriptions and active weights. Audio-only, no-transcription, attribution and uncertainty safeguards remain fixed, and score transport still uses the original seven dimension IDs and the 1–5 scale. Audio quality is explicitly requested even if disabled or zero-weight, in which case it remains diagnostic only.

## What scores mean

- Current rubric **audio-only-v4** retains the v3 **voice persona and pleasant, agreeable, effortless listening** criteria and adds optional, explicitly targeted market/accent fit. Judges assess audible tone, timbre/texture, emotional color, warmth, intonation, rhythm and vocal intelligibility: **how it sounds, not what is said**. They must not reward or penalize script logic, factual correctness, helpfulness, vocabulary simplicity, politeness of wording, quality of explanations, business-process correctness or task completion. A voice does not control the script. Earlier reports keep their original rubric, scores and comments; use Edit inputs for a new evaluation rather than mixing versions through retries.
- Conversational meaning is used only when necessary to attribute agent/customer roles. Role evidence is kept separate from scores; reasons and observations must describe audible vocal traits, not summarize service actions. Warmth and empathy must be audible in tone and prosody, not merely present in reassuring words. Calm or understated voices can score highly without exaggerated emotion.
- Target-style fit uses only the supplied target's **vocal persona, tone and delivery** criteria. Content or business requirements in a target never override the voice-only rubric. If the target contains no usable vocal-style criteria, judges must explain that limitation rather than invent a fit score. The setup screen shows the dimension guidance used in the prompt and assessment function schema.
- All subjective scores are **uncalibrated model opinions**, 1 (very poor) through 5 (excellent), **not human MOS or validated predicted MOS**. This version does not bundle a dedicated MOS predictor.
- With the built-in default, Voice Selection (stored internally as `audition` for compatibility) equally averages naturalness, articulation, pace and expressiveness, plus target-style fit only if supplied and target-market accent fit only if supplied. Microphone/recording quality is a separate diagnostic and does not enter the preference score.
- The default TTS preference also includes audio quality. Custom rubrics use their enabled, positive stage weights, including audio quality if explicitly weighted in Voice Selection. Target-style and accent fit still require their respective targets. Audition and TTS runs are never combined into one ranking.
- Missing, unassessable or unsupported **active** dimensions produce **no overall preference score**, not a zero or silently reweighted score. Explicitly disabled/zero-weight dimensions do not block preference. The weighted mean is `sum(score × weight) / sum(active weights)`.
- Consensus for each region requires the complete configured judge panel. In automatic mode, a window is skipped only when every judge understands the language and agrees that the requested role is **not_present**; excluded-window counts are shown. Ambiguous/unsupported roles, attribution disagreements and failed judges prevent the recording from entering the preference average. An entirely role-absent recording has no score, not a zero.
- Within a recording/role, eligible windows are weighted by input-window duration (not detected target-speaking time). Every non-absent window must be eligible before that recording contributes to its voice/role's equal-weight recording average. Manual mode still requires every selected region.
- Individual dimension summaries also require full panel/region coverage for a recording. Audio quality can remain available as a diagnostic even when linguistic assessment is unsupported.
- Judge spread is mean per-region max-minus-min preference, **not a confidence interval**. Recording score range describes between-recording variation.
- Language support is self-reported by the judge, not independently certified. The language filter includes regions only when all configured judges report the selected language (case-insensitive exact match). Inconsistent language labels require manual inspection.
- Different content, language mixes, emotional demands, microphones and unequal recording sets can bias rankings. There is no statistically established winner. Related models can share errors; repeated copies of the same deployment are not independent human listeners.
- Technical measurements describe the resampled input: peak/RMS dBFS, percentage of near-full-scale samples, and percentage of samples below -40 dBFS. In automatic mode these describe the whole conversation window, not an isolated role. These are not SNR, LUFS, speech detection, or proof of clipping. Original files are never normalized, denoised or overwritten.

Use matched recording conditions and comparable content where possible. Validate the rubric against human listeners fluent in your target languages before using it for important audition decisions. Accent differences are not inherently errors; assess fit only against an explicit market/accent target and never infer personal demographics from voices.

## Persistence, cancellation and privacy

By default, selected PCM excerpts, job metadata, results, panel settings and any saved encrypted connection are stored under `%LOCALAPPDATA%\VoiceQualityWorkbench\data`. On other systems, the base directory is the user's home. `VOICE_DATA_DIR` can override this location. **Audio, metadata and results are unencrypted**; only the saved API key has Windows user encryption. Avoid synced/shared folders for sensitive recordings.

Original recordings stay in their source folder; the browser only reads them. Preparing a run creates local excerpt copies even if preparation later fails. History survives refresh/restart, but the import/editor selection is not restored after a browser refresh. Panel changes do not modify existing jobs.

JSON updates use serialized temporary-file writes followed by atomic replacement. Temporary Windows rename locks (`EPERM`, `EACCES`, `EBUSY`) retry locally up to six times over approximately 2.6 seconds; these retries do not resubmit audio or incur Azure usage. Other errors fail immediately. A persistent save failure still interrupts the evaluation explicitly, aborts and waits for outstanding judges, and leaves the previous valid JSON intact rather than deleting it. Resolve ongoing disk/permission/file-lock issues, then use **Retry incomplete judges** to send audio again; those assessment retries can incur Azure usage.

Cancellation stops active WebSocket requests and pending work; Azure may still bill submitted audio. Retry incomplete judges explicitly to resume a cancelled, interrupted or partially failed run. Completed assessments are preserved, and the original panel/rubric is used. Retrying costs additional usage. After restart, previously running assessments are marked interrupted instead of pretending they completed.

Automatic role attribution was introduced in **audio-only-v2** and is retained in the voice-persona rubric **audio-only-v3**. Older history keeps its original rubric, scores, comments and speaker mode; the report explicitly labels it as earlier-rubric evidence, not a new voice-persona evaluation. Retries across rubric versions are blocked to avoid mixing judgments. Use **Edit inputs** to reuse saved audio and settings, then start a new evaluation to apply the revised criteria to every judge. This incurs new usage; upgrading the app never automatically rescores saved runs. Every CSV export and JSON identifies the evaluation's actual rubric.

The app cannot delete cloud-side service logs; your Azure resource's data-handling policy applies. No browser analytics, remote fonts, or external CDN assets are used. Logs contain operational errors; do not share them without reviewing for sensitive service details. Keep `.env` private.

To remove saved local history/audio, stop the app and remove the specific data directory shown in the startup log. This also removes saved panel settings and the encrypted connection. Use **Remove saved connection** to remove only the saved endpoint/key. There is currently no in-app audio retention/deletion policy.

## Validation

```powershell
npm test
npm run build
```

Tests cover aggregation, profile differences, unsupported/missing scores, region/channel validation, role isolation, PCM/WAV measurements, API persistence/retry/restart behavior, Windows-encrypted credentials, key retention/replacement/removal, configuration redaction, and the Realtime evaluation and connection-test protocols using local test servers. They do not prove scoring accuracy or connectivity to your Azure resource. A real end-to-end assessment requires your deployments, credentials and authorized audio.

Reference: [Azure Realtime WebSocket documentation](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets).

## License

Project source is available under the [MIT license](LICENSE). Third-party dependencies retain their own licenses.
