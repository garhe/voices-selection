import { useEffect, useState } from 'react';

export function AudioPlayer({ src, label, autoPlay = false }: { src: string; label: string; autoPlay?: boolean }) {
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [src]);

  function readDuration(element: HTMLAudioElement) {
    if (Number.isFinite(element.duration) && element.duration > 0) setError('');
    else setError('The audio duration is unavailable. Try reloading this audio.');
  }
  async function playAfterSeek(element: HTMLAudioElement) {
    if (!element.paused || element.ended) return;
    setError('');
    try {
      await element.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && element.paused) return;
      setError(`Unable to seek or play audio: ${error instanceof Error ? error.message : 'Unexpected playback error.'}`);
    }
  }

  return <div className="audio-player">
    <audio controls preload="metadata" src={src} autoPlay={autoPlay} aria-label={label}
      onLoadedMetadata={event => readDuration(event.currentTarget)}
      onDurationChange={event => { if (event.currentTarget.readyState >= 1) readDuration(event.currentTarget); }}
      onSeeked={event => void playAfterSeek(event.currentTarget)}
      onPlay={() => setError('')}
      onError={event => setError(`Unable to load audio: ${event.currentTarget.error?.message || 'Check that the audio is still available.'}`)} />
    {error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
