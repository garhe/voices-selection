import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { type ConnectionStatus } from '../shared/domain.js';
import { realtimeUrl } from './realtime.js';
import { Store } from './store.js';
import { parseAzureEndpoint } from '../shared/azure.js';

export type Credentials = { endpoint: string; key: string };
const storedSchema = z.object({
  version: z.literal(1), endpoint: z.string(), protectedKey: z.string().min(1),
}).strict();
const connectionSchema = z.object({
  endpoint: z.string().trim().min(1).max(300),
  apiKey: z.string().trim().max(512).regex(/^[A-Za-z0-9+/_=-]*$/, 'Use an Azure API key without spaces.').optional(),
}).strict();

export async function protectKey(value: string, operation: 'protect' | 'unprotect'): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Saving API keys from the UI requires Windows user encryption. Configure environment variables on this platform.');
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;
$value=[Console]::In.ReadToEnd();
${operation === 'protect'
    ? '$bytes=[Text.Encoding]::UTF8.GetBytes($value); $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result));'
    : '$bytes=[Convert]::FromBase64String($value); $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($result));'}`;
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let inputFailed = false;
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => { inputFailed = true; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not start Windows user encryption. No credentials were saved.')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !output || inputFailed) reject(new Error(`Could not ${operation === 'protect' ? 'encrypt' : 'decrypt'} the saved API key with this Windows account.`));
      else resolve(output);
    });
    child.stdin.end(value);
  });
}

export class Connection {
  private saved?: Credentials;
  readonly secrets = new Set<string>();
  constructor(private store: Store, private environment: Partial<Credentials>) {
    if (environment.key) this.secrets.add(environment.key);
  }
  async load() {
    if (await this.store.exists('connection.json')) {
      const stored = storedSchema.parse(await this.store.read<unknown>('connection.json'));
      realtimeUrl(stored.endpoint, 'validation');
      const key = await protectKey(stored.protectedKey, 'unprotect');
      this.secrets.add(key); this.saved = { endpoint: stored.endpoint, key };
    }
  }
  status(): ConnectionStatus {
    const endpoint = this.saved?.endpoint ?? this.environment.endpoint ?? '';
    const key = this.saved?.key ?? this.environment.key;
    return {
      configured: !!(endpoint && key), endpoint, keyStored: !!key,
      connectionSource: this.saved ? 'saved' : (endpoint || key) ? 'environment' : 'none',
      secureStorageAvailable: process.platform === 'win32',
    };
  }
  current(): Credentials {
    const value = this.saved ?? this.environment;
    if (!value.endpoint || !value.key) throw new Error('Enter your Azure endpoint and API key in the Azure connection settings.');
    realtimeUrl(value.endpoint, 'validation');
    return { endpoint: parseAzureEndpoint(value.endpoint).endpoint, key: value.key };
  }
  async save(input: unknown) {
    const value = connectionSchema.parse(input);
    const { endpoint } = parseAzureEndpoint(value.endpoint);
    const currentEndpoint = this.status().endpoint;
    const sameEndpoint = !value.apiKey && URL.canParse(currentEndpoint) && parseAzureEndpoint(currentEndpoint).endpoint === endpoint;
    if (!value.apiKey && !sameEndpoint) throw new Error('Enter an API key when configuring a new Azure resource.');
    const key = value.apiKey || this.current().key;
    this.secrets.add(key);
    const protectedKey = await protectKey(key, 'protect');
    await this.store.save('connection.json', { version: 1, endpoint, protectedKey });
    this.saved = { endpoint, key };
    return this.status();
  }
  async clear() {
    if (await this.store.exists('connection.json')) await this.store.remove('connection.json');
    this.saved = undefined;
    return this.status();
  }
  redact(error: unknown) {
    let text = error instanceof Error ? error.message : 'Unexpected failure.';
    for (const secret of this.secrets) text = text.replaceAll(secret, '[REDACTED]');
    return text;
  }
}
