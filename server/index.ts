import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
const dataDir = process.env.VOICE_DATA_DIR
  ? path.resolve(process.env.VOICE_DATA_DIR)
  : path.join(process.env.LOCALAPPDATA || os.homedir(), 'VoiceQualityWorkbench', 'data');
const { app, errors, cancelActive } = await createApp({
  dataDir, port,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT, key: process.env.AZURE_OPENAI_API_KEY,
  deployments: process.env.JUDGE_DEPLOYMENTS,
});
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API route.' }); });
if (process.argv.includes('--production')) {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, fs: { deny: ['**/.env*', '**/.data/**', '**/server/**'] } },
  });
  app.use(vite.middlewares);
}
app.use(errors);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Voices Selection: http://127.0.0.1:${port}`);
  console.log(`Local evaluation data: ${dataDir}`);
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  cancelActive();
  server.close(() => process.exit(0));
});
