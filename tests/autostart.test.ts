import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const run = (code: string) => {
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

test('Windows startup scripts parse and the scheduled task supports a non-writing preview', { skip: process.platform !== 'win32' }, () => {
  const output = run(`
    $ErrorActionPreference = 'Stop'
    foreach ($file in @('Start-VoiceLab.ps1', 'Install-VoiceLabAutoStart.ps1')) {
      $tokens = $null; $errors = $null
      [System.Management.Automation.Language.Parser]::ParseFile((Join-Path ${quote(root)} $file), [ref]$tokens, [ref]$errors) | Out-Null
      if ($errors.Count) { throw ($errors.Message -join '; ') }
    }
    & ${quote(path.join(root, 'Install-VoiceLabAutoStart.ps1'))} -WhatIf
  `);
  assert.match(output, /What if:.*Register sign-in startup and automatic server recovery/);
});

test('Windows watchdog logs server exits and retries without changing the manual launcher', { skip: process.platform !== 'win32' }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'voices-watchdog-'));
  const capture = path.join(temporary, 'launch.json');
  try {
    const output = run(`
      $ErrorActionPreference = 'Stop'
      $env:LOCALAPPDATA = ${quote(temporary)}
      function Start-Process {
        param($FilePath, $ArgumentList, $WorkingDirectory, [switch]$NoNewWindow, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError)
        @{ file = $FilePath; arguments = $ArgumentList; directory = $WorkingDirectory } | ConvertTo-Json | Set-Content -LiteralPath ${quote(capture)}
        return Microsoft.PowerShell.Management\\Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-Command', '"Start-Sleep -Milliseconds 500; exit 23"') -NoNewWindow -PassThru -RedirectStandardOutput $RedirectStandardOutput -RedirectStandardError $RedirectStandardError
      }
      function Start-Sleep {
        param($Seconds)
        if ($Seconds -ne 10) { throw 'Unexpected restart delay' }
        throw 'STOP_WATCHDOG_TEST'
      }
      function Stop-Process { throw 'An exited child must not be stopped' }
      try { & ${quote(path.join(root, 'Start-VoiceLab.ps1'))} -AutoRestart }
      catch { if ($_.Exception.Message -ne 'STOP_WATCHDOG_TEST') { throw } }
      exit 0
    `);
    const launch = JSON.parse(await readFile(capture, 'utf8'));
    assert.deepEqual(launch.arguments, ['--import', 'tsx', 'server\\index.ts']);
    assert.equal(path.resolve(launch.directory), path.resolve(root));
    assert.match(output, /Server exited with code 23\. Restarting in 10 seconds/);
    assert.match(await readFile(path.join(temporary, 'VoiceQualityWorkbench', 'logs', 'watchdog.log'), 'utf8'), /Server started; PID \d+/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
