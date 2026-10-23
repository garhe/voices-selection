import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z, ZodError } from 'zod';
import {
  clipSchema, clipScopeError, settingsSchema, profileSchema, languageHintSchema, resolveLanguageHint, testNameSchema, evaluationName, retryableAudioIssue, SAMPLE_RATE, MAX_SECONDS, RUBRIC_VERSION,
  type Job, type Profile, type StoredClip, type TestQueueState,
} from '../shared/domain.js';
import { measurements, wav } from './audio.js';
import { judgeAudio, JudgeAudioError, testRealtimeConnection } from './realtime.js';
import { Store } from './store.js';
import { Connection, type Credentials } from './credentials.js';
import { testHistory, testMetadataSchema, canManageTest, type BulkTestResult } from '../shared/history.js';

const uuid = z.string().uuid();
const message = (error: unknown) => error instanceof Error ? error.message : 'Unexpected evaluation failure.';
const jobRequest = z.object({
  name: testNameSchema,
  profile: profileSchema,
  clipIds: z.array(uuid).min(1).max(200),
  clipOverrides: z.array(z.object({
    id: uuid, voice: z.string().trim().min(1).max(200), language: languageHintSchema,
  })).max(200).optional(),
  consent: z.literal(true),
  enqueue: z.boolean().optional(),
  judges: settingsSchema.innerType().shape.judges.optional(),
}).refine(r => new Set(r.clipIds).size === r.clipIds.length, 'Clip IDs must be unique.')
  .refine(r => !r.clipOverrides || (new Set(r.clipOverrides.map(c => c.id)).size === r.clipOverrides.length &&
    r.clipOverrides.every(c => r.clipIds.includes(c.id))), 'Clip overrides must be unique and refer to selected clips.');
const bulkJobRequest = z.object({
  action: z.enum(['delete', 'redo']), ids: z.array(uuid).min(1), consent: z.literal(true).optional(),
}).strict().refine(value => new Set(value.ids).size === value.ids.length, 'Test IDs must be unique.')
  .refine(value => value.action !== 'redo' || value.consent === true, 'Redo requires permission to send saved audio to Azure and incur new charges.');

export function validateScope(profile: Profile, clips: StoredClip[]) {
  const error = clipScopeError(profile.scope, clips);
  if (error) throw new Error(error);
}

export async function createApp(options: {
  dataDir: string; endpoint?: string; key?: string; deployments?: string;
  evaluate?: typeof judgeAudio; testConnection?: typeof testRealtimeConnection; port?: number;
}) {
  const store = new Store(options.dataDir);
  await store.init();
  const connection = new Connection(store, { endpoint: options.endpoint, key: options.key });
  await connection.load();
  if (!await store.exists('settings.json')) {
    const deployments = (options.deployments || 'gpt-realtime-2.1,gpt-realtime-2.1-mini').split(',').map(s => s.trim()).filter(Boolean);
    await store.save('settings.json', settingsSchema.parse({
      judges: deployments.map((deployment, i) => ({ id: randomUUID(), name: `Judge ${i + 1}`, deployment })),
    }));
  }
  settingsSchema.parse(await store.settings());
  const savedJobs = await store.jobs();
  for (const job of savedJobs) {
    if (job.status === 'running') {
      job.status = 'interrupted';
      for (const result of job.results) if (['running', 'pending'].includes(result.status)) {
        result.status = 'interrupted'; result.error = 'Server stopped before this assessment completed. Resume to retry.';
      }
      await store.saveJob(job);
    }
  }
  const app = express();
  app.disable('x-powered-by');
  let active: { job: Job; controller: AbortController } | undefined;
  const waiting = savedJobs.filter(job => job.status === 'queued')
    .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0) || a.createdAt.localeCompare(b.createdAt));
  let queueOrder = Math.max(0, ...savedJobs.map(job => job.queueOrder ?? 0));
  let queuePaused = waiting.length > 0;
  let queueError: string | undefined;
  let dispatching = false;
  let queuedWrites = 0;
  const changingJobs = new Set<string>();
  let runtimeError: string | undefined;
  const evaluate = options.evaluate ?? judgeAudio;
  const testConnection = options.testConnection ?? testRealtimeConnection;
  let connectionWrite = false;
  let testingConnection = false;
  function queueState(): TestQueueState {
    return {
      paused: queuePaused, error: queueError,
      active: active ? { id: active.job.id, name: evaluationName(active.job) } : undefined,
      waiting: waiting.map(job => ({ id: job.id, name: evaluationName(job) })),
    };
  }
  async function drainQueue() {
    if (active || dispatching || queuedWrites || queuePaused || !waiting.length) return;
    dispatching = true;
    let next: Job | undefined;
    try {
      const credentials = connection.current();
      next = waiting.shift()!;
      const controller = new AbortController();
      next.status = 'running'; active = { job: next, controller };
      await store.saveJob(next);
      void run(next, controller, credentials);
    } catch (error) {
      queuePaused = true;
      queueError = `Queue paused: ${connection.redact(error)}. Resolve the problem and start the queue again.`;
      console.error(queueError);
      if (next) { next.status = 'queued'; waiting.unshift(next); active = undefined; }
    } finally { dispatching = false; }
  }
  function newEvaluation(input: Pick<Job, 'name' | 'profile' | 'judges' | 'clips'>, enqueue: boolean): Job {
    return {
      ...input, id: randomUUID(), createdAt: new Date().toISOString(), status: enqueue ? 'queued' : 'running',
      rubric: RUBRIC_VERSION,
      results: input.clips.flatMap(clip => input.judges.map(judge => ({ clipId: clip.id, judgeId: judge.id, status: 'pending' }))),
    };
  }
  async function enqueueEvaluation(job: Job) {
    job.queueOrder = ++queueOrder;
    await store.saveJob(job);
    waiting.push(job); waiting.sort((a, b) => a.queueOrder! - b.queueOrder!);
  }
  function ensureChangeable(id: string) {
    if (active?.job.id === id || waiting.some(job => job.id === id) || changingJobs.has(id))
      throw new Error('This test is running, queued or being changed. Cancel a waiting test or wait for it to finish.');
  }
  async function deleteEvaluation(id: string) {
    ensureChangeable(id);
    changingJobs.add(id);
    try { await store.remove(path.join('jobs', `${id}.json`)); }
    finally { changingJobs.delete(id); }
  }
  app.use((req, res, next) => {
    const host = req.headers.host;
    const allowedHosts = [`127.0.0.1:${options.port ?? 4310}`, `localhost:${options.port ?? 4310}`];
    if (!host || !allowedHosts.includes(host)) { res.status(403).json({ error: 'Only the local application host is allowed.' }); return; }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return;
    }
    if (req.path.startsWith('/api') && req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: 'Cross-site requests are not allowed.' }); return;
    }
    if (req.path.startsWith('/.data') || req.path.startsWith('/.env')) { res.sendStatus(404); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '9mb' }));
  app.get('/api/config', async (_req, res) => res.json({
    ...await store.settings(), ...connection.status(), runtimeError, rubric: RUBRIC_VERSION,
  }));
  app.put('/api/connection', async (req, res) => {
    if (connectionWrite) { res.status(409).json({ error: 'Connection settings are already being saved. Try again shortly.' }); return; }
    connectionWrite = true;
    try { res.json(await connection.save(req.body)); }
    finally { connectionWrite = false; }
  });
  app.delete('/api/connection', async (_req, res) => {
    if (connectionWrite) { res.status(409).json({ error: 'Connection settings are already being saved. Try again shortly.' }); return; }
    connectionWrite = true;
    try { res.json(await connection.clear()); }
    finally { connectionWrite = false; }
  });
  app.post('/api/connection/test', async (req, res) => {
    const { judges } = settingsSchema.parse(req.body);
    if (testingConnection) { res.status(409).json({ error: 'A connection test is already running.' }); return; }
    const credentials = connection.current();
    testingConnection = true;
    try {
      const results = await Promise.all(judges.map(async judge => {
        try {
          const output = await testConnection({ ...credentials, judge });
          return { judgeId: judge.id, ok: true, model: output.model };
        } catch (error) {
          const detail = connection.redact(error);
          console.error(`Connection test for ${judge.name} failed: ${detail}`);
          return { judgeId: judge.id, ok: false, error: detail };
        }
      }));
      res.json({ results });
    } finally { testingConnection = false; }
  });
  app.put('/api/settings', async (req, res) => {
    const settings = settingsSchema.parse(req.body);
    await store.save('settings.json', settings); res.json(settings);
  });
  app.post('/api/clips', async (req, res) => {
    const { clip, pcm } = z.object({
      clip: clipSchema,
      pcm: z.string().min(1).max(SAMPLE_RATE * 2 * MAX_SECONDS * 4 / 3 + 4)
        .refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'Invalid base64 audio.'),
    }).parse(req.body);
    const bytes = Buffer.from(pcm, 'base64');
    const seconds = bytes.length / (SAMPLE_RATE * 2);
    if (bytes.length % 2 || seconds < 0.5 || seconds > MAX_SECONDS || Math.abs(seconds - (clip.end - clip.start)) > 0.025) {
      res.status(400).json({ error: `Audio must be 24 kHz mono PCM16, match the selected duration, and last 0.5-${MAX_SECONDS} seconds.` }); return;
    }
    const stored = { ...clip, technical: measurements(bytes) };
    await store.saveClip(stored, bytes);
    res.status(201).json(stored);
  });
  app.get('/api/clips/:id/audio', async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.type('wav').send(wav(await store.pcm(id)));
  });
  app.get('/api/jobs', async (_req, res) => {
    const jobs = await store.jobs();
    res.json(jobs.map(j => testHistory(active?.job.id === j.id ? active.job : j)));
  });
  app.post('/api/jobs/bulk', async (req, res) => {
    const input = bulkJobRequest.parse(req.body);
    if (input.action === 'redo') { connection.current(); queuedWrites++; }
    const result: BulkTestResult = { succeeded: [], failed: [] };
    try {
      for (const id of input.ids) {
        try {
          if (input.action === 'delete') {
            await deleteEvaluation(id);
            result.succeeded.push({ id });
            continue;
          }
          ensureChangeable(id);
          changingJobs.add(id);
          try {
            const source = await store.read<Job>(path.join('jobs', `${id}.json`));
            if (!canManageTest(source)) throw new Error('This test is running or queued. Wait or cancel it before redoing.');
            const profile = profileSchema.parse(source.profile);
            const { judges } = settingsSchema.parse({ judges: source.judges });
            if (!source.clips.length || source.clips.length > 200) throw new Error('Redo requires 1-200 saved audio inputs. Use Edit inputs to prepare a new test.');
            const clips = source.clips.map(clip => ({ ...clip, ...clipSchema.parse(clip) }));
            validateScope(profile, clips);
            for (const clip of clips)
              if (!await store.hasPcm(clip.id)) throw new Error(`Saved audio is unavailable for ${clip.file}. Import the original recording again.`);
            const job = newEvaluation({ name: evaluationName(source), profile, judges, clips }, true);
            if (source.voiceLabels) job.voiceLabels = source.voiceLabels.map(label => ({ ...label }));
            await enqueueEvaluation(job);
            result.succeeded.push({ id, newId: job.id });
          } finally { changingJobs.delete(id); }
        } catch (error) {
          const detail = error instanceof ZodError
            ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
            : connection.redact(error);
          console.error(`Bulk ${input.action} failed for test ${id}: ${detail}`);
          result.failed.push({ id, error: detail });
        }
      }
      res.json(result);
    } finally {
      if (input.action === 'redo') queuedWrites--;
      void drainQueue();
    }
  });
  app.get('/api/queue', (_req, res) => res.json(queueState()));
  app.post('/api/queue/pause', (_req, res) => {
    queuePaused = true; res.json(queueState());
  });
  app.post('/api/queue/start', async (req, res) => {
    z.object({ consent: z.literal(true) }).parse(req.body);
    connection.current();
    queuePaused = false; queueError = undefined;
    await drainQueue(); res.json(queueState());
  });
  app.get('/api/jobs/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.json(active?.job.id === id ? active.job : await store.read<Job>(path.join('jobs', `${id}.json`)));
  });
  app.get('/api/jobs/:id/draft', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const job = await store.read<Job>(path.join('jobs', `${id}.json`));
    const available = await Promise.all(job.clips.map(c => store.hasPcm(c.id)));
    res.json({ job, clips: job.clips.filter((_c, i) => available[i]), missing: available.filter(value => !value).length });
  });
  app.patch('/api/jobs/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const metadata = testMetadataSchema.parse(req.body);
    if (active?.job.id === id || waiting.some(job => job.id === id) || changingJobs.has(id)) {
      res.status(409).json({ error: 'This evaluation is running, queued or being changed. Cancel a waiting test before editing its labels.' }); return;
    }
    changingJobs.add(id);
    try {
      const job = await store.read<Job>(path.join('jobs', `${id}.json`));
      if (metadata.voiceLabels.some(label => !job.clips.some(clip => clip.voice === label.voice))) {
        res.status(400).json({ error: 'Gender labels must refer to voices in this evaluation.' }); return;
      }
      job.name = metadata.name; job.voiceLabels = metadata.voiceLabels;
      await store.saveJob(job);
      res.json(job);
    } finally { changingJobs.delete(id); }
  });
  app.delete('/api/jobs/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (active?.job.id === id || waiting.some(job => job.id === id) || changingJobs.has(id)) {
      res.status(409).json({ error: 'This evaluation is running, queued or being changed. Cancel a waiting test before deleting it.' }); return;
    }
    await deleteEvaluation(id);
    res.json({ deleted: id });
  });
  async function run(job: Job, controller: AbortController, credentials: Credentials, selected = job.results) {
    try {
      if (job.rubric !== RUBRIC_VERSION) throw new Error('The rubric changed. Create a new evaluation with the current rubric.');
      for (const clip of job.clips) {
        if (controller.signal.aborted) break;
        if (!selected.some(r => r.clipId === clip.id && r.status !== 'completed')) continue;
        const pcm = await store.pcm(clip.id);
        const tasks = job.judges.map(async judge => {
          const result = job.results.find(r => r.clipId === clip.id && r.judgeId === judge.id)!;
          if (!selected.includes(result) || result.status === 'completed') return;
          if (controller.signal.aborted) { result.status = 'cancelled'; return; }
          result.status = 'running'; delete result.error; delete result.responseFormat;
          delete result.assessment; delete result.model; delete result.audioDiagnostics;
          await store.saveJob(job);
          if (controller.signal.aborted) { result.status = 'cancelled'; return; }
          try {
            const output = await evaluate({
              ...credentials, judge, pcm, role: clip.role,
              profile: { ...job.profile, language: resolveLanguageHint(clip.language, job.profile.language) }, signal: controller.signal,
            });
            result.assessment = output.assessment; result.model = output.model; result.status = 'completed';
            result.responseFormat = output.responseFormat;
            result.audioDiagnostics = output.audioDiagnostics;
            if (output.responseFormat === 'function_call_with_preamble')
              console.warn(`Judge ${judge.name} returned a validated function with a non-assessment preamble; the preamble was ignored, not scored.`);
            else if (output.responseFormat && output.responseFormat !== 'function_call')
              console.warn(`Judge ${judge.name} returned ${output.responseFormat} instead of a function call; accepted after full assessment validation.`);
          } catch (error) {
            result.status = controller.signal.aborted ? 'cancelled' : 'failed';
            result.error = connection.redact(error);
            if (error instanceof JudgeAudioError) {
              result.audioDiagnostics = error.audioDiagnostics;
              for (const session of result.audioDiagnostics.sessions)
                if (session.error) session.error = connection.redact(new Error(session.error));
            }
            console.error(`Judge ${judge.name} failed for clip ${clip.id}: ${result.error}`);
          }
          await store.saveJob(job);
        });
        try { await Promise.all(tasks); }
        catch (error) {
          controller.abort();
          await Promise.allSettled(tasks);
          throw error;
        }
      }
      const status = controller.signal.aborted ? 'cancelled' : 'completed';
      for (const r of selected) if (r.status === 'pending' || r.status === 'running') {
        r.status = 'cancelled'; r.error = 'Evaluation cancelled before completion.';
      }
      await store.saveJob({ ...job, status });
      job.status = status;
    } catch (error) {
      runtimeError = `Evaluation interrupted: ${connection.redact(error)}`;
      console.error(runtimeError);
      for (const r of selected) if (r.status === 'pending' || r.status === 'running') {
        r.status = 'interrupted'; r.error = runtimeError;
      }
      try { await store.saveJob({ ...job, status: 'interrupted' }); }
      catch (saveError) { console.error('Could not persist interrupted state:', message(saveError)); }
      job.status = 'interrupted';
    } finally {
      active = undefined;
      void drainQueue();
    }
  }
  app.post('/api/jobs', async (req, res) => {
    const input = jobRequest.parse(req.body);
    if (!input.enqueue && (active || dispatching || queuedWrites || waiting.length)) {
      res.status(409).json({ error: 'Another evaluation is running or queued. Add this test to the queue instead.' }); return;
    }
    if (input.enqueue) queuedWrites++;
    try {
      const credentials = connection.current();
      const settings = settingsSchema.parse(input.judges ? { judges: input.judges } : await store.settings());
      const clips = await Promise.all(input.clipIds.map(async id => {
        const clip = await store.clip(id);
        const override = input.clipOverrides?.find(c => c.id === id);
        if (!await store.hasPcm(id)) throw new Error(`Saved audio is unavailable for ${clip.file}. Import the original recording again.`);
        return {
          ...clip, ...(override ? { voice: override.voice } : {}),
          language: resolveLanguageHint(override?.language ?? clip.language, input.profile.language),
        };
      }));
      validateScope(input.profile, clips);
      // Recheck after asynchronous reads so two requests cannot start concurrent runs.
      if (!input.enqueue && (active || dispatching || queuedWrites || waiting.length)) {
        res.status(409).json({ error: 'Another evaluation is running or queued. Add this test to the queue instead.' }); return;
      }
      const job = newEvaluation({ name: input.name, profile: input.profile, judges: settings.judges, clips }, !!input.enqueue);
      if (input.enqueue) {
        await enqueueEvaluation(job);
        res.status(201).json(job);
        return;
      }
      const controller = new AbortController();
      active = { job, controller };
      try { await store.saveJob(job); }
      catch (error) { active = undefined; throw error; }
      void run(job, controller, credentials);
      res.status(201).json(job);
    } finally {
      if (input.enqueue) queuedWrites--;
      void drainQueue();
    }
  });
  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (changingJobs.has(id)) { res.status(409).json({ error: 'This evaluation is being changed.' }); return; }
    const index = waiting.findIndex(job => job.id === id);
    if (index >= 0) {
      const [job] = waiting.splice(index, 1);
      changingJobs.add(id);
      job.status = 'cancelled';
      for (const result of job.results) {
        result.status = 'cancelled'; result.error = 'Cancelled before the queued test started.';
      }
      try { await store.saveJob(job); res.json({ status: 'cancelled' }); }
      catch (error) {
        job.status = 'queued';
        for (const result of job.results) { result.status = 'pending'; delete result.error; }
        waiting.splice(index, 0, job); queuePaused = true;
        queueError = `Queue paused: cancellation could not be saved. ${connection.redact(error)}`;
        console.error(queueError); throw error;
      } finally { changingJobs.delete(id); }
      return;
    }
    if (!active || active.job.id !== id) { res.status(409).json({ error: 'This evaluation is not running.' }); return; }
    active.controller.abort(); res.json({ status: 'cancelling' });
  });
  app.post('/api/jobs/:id/resume', async (req, res) => {
    const { retryAudioIssues } = z.object({ consent: z.literal(true), retryAudioIssues: z.boolean().optional() }).parse(req.body);
    if (active || dispatching || queuedWrites || waiting.length) { res.status(409).json({ error: 'Another evaluation is running or queued. Wait for the queue to finish.' }); return; }
    const credentials = connection.current();
    const id = uuid.parse(req.params.id);
    if (changingJobs.has(id)) { res.status(409).json({ error: 'This evaluation is being changed.' }); return; }
    changingJobs.add(id);
    try {
      const job = await store.read<Job>(path.join('jobs', `${id}.json`));
      if (job.status === 'queued' || active || dispatching || queuedWrites || waiting.length) { res.status(409).json({ error: 'An evaluation is running or queued. Use the queue controls or wait for it to finish.' }); return; }
      if (job.rubric !== RUBRIC_VERSION) { res.status(409).json({ error: 'The rubric changed. Start a new evaluation instead of mixing rubric versions.' }); return; }
      const selected = job.results.filter(r => retryAudioIssues ? retryableAudioIssue(r) : r.status !== 'completed');
      if (!selected.length) {
        res.status(409).json({ error: retryAudioIssues ? 'No completed assessments report a retryable missing-audio claim.' : 'All judge assessments have already completed.' }); return;
      }
      for (const clip of job.clips.filter(c => selected.some(r => r.clipId === c.id)))
        if (!await store.hasPcm(clip.id)) {
          res.status(409).json({ error: `Saved audio is unavailable for ${clip.file}. Import the original recording again.` }); return;
        }
      if (active || dispatching || queuedWrites || waiting.length) { res.status(409).json({ error: 'Another evaluation is running or queued. Wait for the queue to finish.' }); return; }
      for (const r of selected) {
        const { clipId: _clipId, judgeId: _judgeId, previousEvaluations, ...evaluation } = r;
        r.previousEvaluations = [...(previousEvaluations ?? []), { ...evaluation, retriedAt: new Date().toISOString() }];
        r.status = 'pending'; delete r.error; delete r.assessment; delete r.model; delete r.responseFormat; delete r.audioDiagnostics;
      }
      job.status = 'running';
      const controller = new AbortController(); active = { job, controller };
      try { await store.saveJob(job); }
      catch (error) { active = undefined; throw error; }
      void run(job, controller, credentials, selected); res.json(job);
    } finally { changingJobs.delete(id); }
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      console.error('API request failed: Invalid JSON body.');
      res.status(400).json({ error: 'Invalid JSON request body.' }); return;
    }
    console.error('API request failed:', connection.redact(error));
    if (error instanceof ZodError) { res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      res.status(404).json({ error: 'The requested local recording or evaluation was not found.' }); return;
    }
    if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Audio upload exceeds the supported excerpt size.' }); return;
    }
    res.status(400).json({ error: connection.redact(error) });
  };
  return { app, errors, store, cancelActive: () => { queuePaused = true; active?.controller.abort(); } };
}
