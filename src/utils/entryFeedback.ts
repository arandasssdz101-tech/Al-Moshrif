export type EntryFeedbackKind = 'accepted' | 'late' | 'duplicate' | 'error';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => undefined);
  }
  return sharedAudioCtx;
}

function playToneSequence(notes: { freq: number; duration: number; delay: number; type: OscillatorType; gain: number }[]): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime;

  for (const note of notes) {
    try {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, start + note.delay);
      gainNode.gain.setValueAtTime(0.001, start + note.delay);
      gainNode.gain.exponentialRampToValueAtTime(note.gain, start + note.delay + 0.012);
      gainNode.gain.exponentialRampToValueAtTime(0.001, start + note.delay + note.duration);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(start + note.delay);
      osc.stop(start + note.delay + note.duration + 0.02);
    } catch {
      // Ignore audio scheduling failure on locked/muted devices
    }
  }
}

export function playEntryFeedback(
  kind: EntryFeedbackKind,
  options: { soundEnabled: boolean; vibrationEnabled: boolean },
): void {
  if (options.soundEnabled) {
    switch (kind) {
      case 'accepted':
        playToneSequence([
          { freq: 880, duration: 0.09, delay: 0, type: 'sine', gain: 0.22 },
          { freq: 1175, duration: 0.13, delay: 0.09, type: 'sine', gain: 0.24 },
        ]);
        break;
      case 'late':
        playToneSequence([
          { freq: 660, duration: 0.12, delay: 0, type: 'triangle', gain: 0.24 },
          { freq: 523, duration: 0.16, delay: 0.13, type: 'triangle', gain: 0.24 },
        ]);
        break;
      case 'duplicate':
        playToneSequence([
          { freq: 340, duration: 0.12, delay: 0, type: 'square', gain: 0.16 },
          { freq: 280, duration: 0.14, delay: 0.14, type: 'square', gain: 0.16 },
        ]);
        break;
      case 'error':
        playToneSequence([
          { freq: 240, duration: 0.18, delay: 0, type: 'sawtooth', gain: 0.18 },
          { freq: 180, duration: 0.22, delay: 0.19, type: 'sawtooth', gain: 0.18 },
        ]);
        break;
    }
  }

  if (options.vibrationEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      if (kind === 'accepted') navigator.vibrate([55]);
      else if (kind === 'late') navigator.vibrate([95, 55, 95]);
      else if (kind === 'duplicate') navigator.vibrate([130, 65, 130]);
      else navigator.vibrate([210, 75, 210]);
    } catch {
      // Ignore vibration rejection
    }
  }
}
