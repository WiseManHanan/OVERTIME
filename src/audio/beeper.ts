/*
 * The beeper (doc §4.5): one square-wave oscillator, one gain node, a hard
 * ~40ms envelope. No filters, no reverb, no samples, no polyphony. A "chord" is
 * a fast arpeggio, exactly as the original hardware faked it. Every frequency
 * sits in a narrow 400–2000Hz band.
 *
 * This is the only place in the codebase that makes sound, and it is driven
 * entirely by main.ts diffing successive `GameState`s — the simulation itself
 * stays silent and pure (invariant 1).
 */

export type Cue =
  | "step"
  | "jump"
  | "nearMiss"
  | "bolt"
  | "miss"
  | "roundClear"
  | "bell";

/** `[frequencyHz, durationMs]`, played back-to-back on the single voice. */
type Note = readonly [number, number];

const SEQUENCES: Record<Cue, readonly Note[]> = {
  step: [[520, 26]],
  jump: [[720, 34], [1040, 46]],
  nearMiss: [[1180, 28], [1720, 44]], // rising blip (doc §4.5)
  bolt: [[560, 34], [820, 34], [1120, 60]], // ratchet up
  miss: [[720, 60], [560, 66], [430, 96]], // descending three-note
  roundClear: [
    [660, 56],
    [880, 56],
    [990, 56],
    [1320, 64],
    [1180, 56],
    [1580, 128],
  ],
  bell: [[1760, 40], [1320, 52], [1760, 132]],
};

const PEAK = 0.16; // conservative — the voice is thin and a bit shrill by design
const ATTACK = 0.004;
const RELEASE = 0.02;

export interface Beeper {
  /** Play a cue, unless muted or the context has not been unlocked yet. */
  play(cue: Cue): void;
  /** Resume/create the AudioContext — call from a user-gesture handler. */
  resume(): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

export function createBeeper(initialMuted: boolean): Beeper {
  let muted = initialMuted;
  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;

  function ensure(): void {
    if (ctx !== null) {
      if (ctx.state === "suspended") void ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctor === undefined) return;

    ctx = new Ctor();
    osc = ctx.createOscillator();
    osc.type = "square";
    gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
  }

  return {
    get muted(): boolean {
      return muted;
    },

    resume(): void {
      ensure();
    },

    setMuted(next: boolean): void {
      muted = next;
      if (muted && gain !== null && ctx !== null) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
      }
    },

    play(cue: Cue): void {
      if (muted) return;
      ensure();
      if (ctx === null || osc === null || gain === null) return;
      if (ctx.state === "suspended") void ctx.resume();

      // Monophonic voice: drop whatever the previous cue still had scheduled so
      // the two timelines can't interleave into wrong pitches and clicks.
      let t = ctx.currentTime + 0.001;
      osc.frequency.cancelScheduledValues(t);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.0001, t);
      for (const [freq, ms] of SEQUENCES[cue]) {
        const dur = ms / 1000;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(PEAK, t + ATTACK);
        gain.gain.setValueAtTime(PEAK, t + Math.max(ATTACK, dur - RELEASE));
        gain.gain.linearRampToValueAtTime(0.0001, t + dur);
        t += dur;
      }
    },
  };
}
