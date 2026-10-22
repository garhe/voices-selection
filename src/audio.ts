import { MAX_SECONDS, SAMPLE_RATE, rolesForScope, type Profile } from '../shared/domain';

export type Region = {
  id: string; role: 'speaker' | 'agent' | 'customer'; start: number; end: number;
  channel: 'mix' | 'left' | 'right'; confirmed: boolean;
};
export type Recording = {
  id: string; file: File; path: string; voice: string; duration?: number; channels?: number;
  regions: Region[]; language: string; include: boolean;
};
export function automaticRegions(duration: number, scope: Profile['scope']): Region[] {
  if (!Number.isFinite(duration) || duration < 0.5) throw new Error('Automatic evaluation needs at least 0.5 seconds of decodable audio.');
  const windows = Math.ceil(duration / MAX_SECONDS);
  const regions: Region[] = [];
  for (let i = 0; i < windows; i++) for (const role of rolesForScope(scope)) regions.push({
    id: crypto.randomUUID(), role, start: duration * i / windows, end: duration * (i + 1) / windows,
    channel: 'mix', confirmed: false,
  });
  return regions;
}
export async function decode(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try { return await context.decodeAudioData(await file.arrayBuffer()); }
  finally { await context.close(); }
}
export function validateRegion(region: Region, duration: number, channels: number) {
  if (!Number.isFinite(region.start) || !Number.isFinite(region.end) || region.start < 0 || region.end > duration + 0.001 ||
    region.end - region.start < 0.5 || region.end - region.start > MAX_SECONDS)
    throw new Error(`Select an in-file excerpt lasting 0.5-${MAX_SECONDS} seconds.`);
  if (region.channel === 'right' && channels < 2) throw new Error('This recording has no right channel.');
}
export async function toPcm(buffer: AudioBuffer, region: Region): Promise<ArrayBuffer> {
  validateRegion(region, buffer.duration, buffer.numberOfChannels);
  const frames = Math.round((region.end - region.start) * SAMPLE_RATE);
  const context = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const source = context.createBufferSource();
  const mono = context.createBuffer(1, buffer.length, buffer.sampleRate);
  const samples = mono.getChannelData(0);
  const channel = region.channel === 'right' ? 1 : 0;
  if (region.channel !== 'mix') samples.set(buffer.getChannelData(channel));
  else for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
  }
  source.buffer = mono; source.connect(context.destination);
  source.start(0, region.start, region.end - region.start);
  const rendered = await context.startRendering();
  const data = rendered.getChannelData(0);
  const output = new ArrayBuffer(data.length * 2);
  const view = new DataView(output);
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(i * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
  }
  return output;
}
export function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(''));
}
export function browserWav(pcm: ArrayBuffer): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, pcm.byteLength + 36, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}
