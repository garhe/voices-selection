import { SAMPLE_RATE, type Technical } from '../shared/domain.js';

export function measurements(pcm: Buffer): Technical {
  let peak = 0, squares = 0, clipped = 0, quiet = 0;
  const count = pcm.length / 2;
  for (let i = 0; i < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i) / 32768;
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    squares += sample * sample;
    if (absolute >= 0.999) clipped++;
    if (absolute < 0.01) quiet++;
  }
  const rms = Math.sqrt(squares / count);
  return {
    peakDb: peak ? 20 * Math.log10(peak) : null, rmsDb: rms ? 20 * Math.log10(rms) : null,
    clippingPercent: 100 * clipped / count, quietPercent: 100 * quiet / count, seconds: count / SAMPLE_RATE,
  };
}
export function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
