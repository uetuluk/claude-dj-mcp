/**
 * audio-engine.ts — Server-side Strudel pattern rendering using node-web-audio-api.
 *
 * Polyfills Web Audio API globals so Strudel's core + transpiler + superdough synth
 * modules can run in Node.js. Provides evaluatePattern() to parse Strudel code and
 * renderChunk() to offline-render a time slice to PCM Float32 stereo buffers.
 *
 * MVP scope: synth waveforms only (sine, square, sawtooth, triangle).
 * No AudioWorklets, no sample loading. Worklets are disabled via initAudio({ disableWorklets: true }).
 */

import * as nodeWebAudio from "node-web-audio-api";
import { log } from "./logger.js";

// ── Polyfill Web Audio globals before importing Strudel ──────────────
// Superdough references many Web Audio constructors as globals
// (BaseAudioContext, AudioNode, AudioParam, AudioScheduledSourceNode, etc.).
// Polyfill everything node-web-audio-api exports.

const g = globalThis as Record<string, unknown>;
for (const [key, value] of Object.entries(nodeWebAudio)) {
  if (typeof value === "function") {
    g[key] = value;
  }
}

const NodeAudioContext = nodeWebAudio.AudioContext;
const NodeOfflineAudioContext = nodeWebAudio.OfflineAudioContext;

// ── Now import Strudel (must happen after polyfill) ──────────────────

// We dynamically import Strudel modules to ensure polyfill is in place first.
// The modules are cached after first import.

let strudelCore: typeof import("@strudel/core");
let strudelTranspiler: typeof import("@strudel/transpiler");
let strudelMini: typeof import("@strudel/mini");
let strudelTonal: typeof import("@strudel/tonal");

// superdough types (loaded dynamically from local strudel)
let superdoughMod: {
  superdough: (value: Record<string, unknown>, t: number, hapDuration: number, cps: number, cycle: number) => Promise<void>;
  registerSound: (key: string, onTrigger: unknown, data?: Record<string, unknown>) => void;
  initAudio: (opts: Record<string, unknown>) => Promise<void>;
  setSuperdoughAudioController: (ctrl: unknown) => void;
  resetGlobalEffects: () => void;
};
let superdoughLogger: {
  setLogger: (fn: (...args: unknown[]) => void) => void;
};
let superdoughOutput: {
  SuperdoughAudioController: new (ctx: unknown) => unknown;
};
let synthModule: {
  registerSynthSounds: () => void;
};
let audioContextMod: {
  setAudioContext: (ctx: unknown) => unknown;
  getAudioContext: () => unknown;
};

let engineInitialized = false;

export const SAMPLE_RATE = 44100;
export const CHANNELS = 2;

/**
 * Initialize the audio engine: load Strudel modules, register eval scope, register synth sounds.
 */
export async function initEngine(): Promise<void> {
  if (engineInitialized) return;

  log.info("Initializing audio engine...");

  // Load core Strudel packages
  strudelCore = await import("@strudel/core");
  strudelMini = await import("@strudel/mini");
  strudelTonal = await import("@strudel/tonal");
  strudelTranspiler = await import("@strudel/transpiler");

  // Load superdough from the local strudel tree (not via npm)
  // We import sub-modules to avoid the barrel export that pulls in worklets
  const superdoughPath = new URL(
    "../strudel/packages/superdough/superdough.mjs",
    import.meta.url
  ).href;
  const superdoughOutputPath = new URL(
    "../strudel/packages/superdough/superdoughoutput.mjs",
    import.meta.url
  ).href;
  const synthPath = new URL(
    "../strudel/packages/superdough/synth.mjs",
    import.meta.url
  ).href;
  const audioContextPath = new URL(
    "../strudel/packages/superdough/audioContext.mjs",
    import.meta.url
  ).href;
  const loggerPath = new URL(
    "../strudel/packages/superdough/logger.mjs",
    import.meta.url
  ).href;

  superdoughMod = await import(superdoughPath);
  superdoughOutput = await import(superdoughOutputPath);
  synthModule = await import(synthPath);
  superdoughLogger = await import(loggerPath);

  audioContextMod = await import(audioContextPath);

  // Redirect superdough logging to our logger
  superdoughLogger.setLogger((...args: unknown[]) => {
    log.debug("[superdough]", ...args);
  });

  // Create a temporary AudioContext to bootstrap superdough (needed for synth registration)
  const bootCtx = new NodeAudioContext() as unknown;
  audioContextMod.setAudioContext(bootCtx);

  // Register synth sounds (sine, square, sawtooth, triangle, supersaw, etc.)
  synthModule.registerSynthSounds();

  // Register Strudel modules into the eval scope so user code has access
  // to all the standard functions (note, s, stack, etc.)
  const { evalScope } = strudelCore;
  await evalScope(
    import("@strudel/core"),
    import("@strudel/mini"),
    import("@strudel/tonal"),
  );

  // Close the bootstrap context — we'll make fresh OfflineAudioContexts per render
  await (bootCtx as InstanceType<typeof NodeAudioContext>).close();

  engineInitialized = true;
  log.info("Audio engine initialized (synth sounds registered)");
}

/**
 * Evaluate Strudel code and return the resulting Pattern object.
 * The code is transpiled (mini-notation support, etc.) then evaluated.
 */
export async function evaluatePattern(code: string): Promise<unknown> {
  if (!engineInitialized) {
    throw new Error("Audio engine not initialized. Call initEngine() first.");
  }

  const { pattern } = await strudelTranspiler.evaluate(code);
  return pattern;
}

/**
 * Render a chunk of a pattern to stereo PCM Float32 arrays using OfflineAudioContext.
 *
 * @param pattern   The Pattern object from evaluatePattern()
 * @param cycleStart  Start cycle number (e.g. 0.0, 2.0)
 * @param cycleEnd    End cycle number
 * @param cps         Cycles per second (tempo)
 * @returns           { left, right } Float32Arrays of rendered audio
 */
export async function renderChunk(
  pattern: unknown,
  cycleStart: number,
  cycleEnd: number,
  cps: number
): Promise<{ left: Float32Array; right: Float32Array }> {
  const durationSeconds = (cycleEnd - cycleStart) / cps;
  const totalFrames = Math.ceil(durationSeconds * SAMPLE_RATE);

  if (totalFrames <= 0) {
    return {
      left: new Float32Array(0),
      right: new Float32Array(0),
    };
  }

  // Create an OfflineAudioContext for this chunk
  const offlineCtx = new NodeOfflineAudioContext(
    CHANNELS,
    totalFrames,
    SAMPLE_RATE
  ) as unknown;

  // Point superdough at this context
  audioContextMod.setAudioContext(offlineCtx);
  superdoughMod.setSuperdoughAudioController(
    new superdoughOutput.SuperdoughAudioController(offlineCtx)
  );

  // Initialize audio (worklets disabled for MVP)
  await superdoughMod.initAudio({
    disableWorklets: true,
    maxPolyphony: 64,
    multiChannelOrbits: false,
  });

  // Query the pattern for haps (events) in this time range
  const pat = pattern as {
    queryArc: (
      begin: number,
      end: number,
      opts: Record<string, unknown>
    ) => Array<{
      whole: { begin: { valueOf: () => number }; end: { valueOf: () => number } };
      value: Record<string, unknown>;
      duration: number;
      hasOnset: () => boolean;
      ensureObjectValue: () => void;
    }>;
  };

  const haps = pat
    .queryArc(cycleStart, cycleEnd, { _cps: cps })
    .sort(
      (a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf()
    );

  // Schedule each hap into the OfflineAudioContext
  for (const hap of haps) {
    if (hap.hasOnset()) {
      try {
        hap.ensureObjectValue();
        const onset =
          (hap.whole.begin.valueOf() - cycleStart) / cps;
        const hapDur = hap.duration / cps;
        await superdoughMod.superdough(
          hap.value,
          onset,
          hapDur,
          cps,
          (hap.whole.begin.valueOf() - cycleStart) / cps
        );
      } catch (err) {
        // Silently skip errors for individual haps (e.g. missing samples)
        log.debug(
          "renderChunk hap error:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  // Render the offline context
  const renderedBuffer = await (
    offlineCtx as InstanceType<typeof NodeOfflineAudioContext>
  ).startRendering();

  const left = new Float32Array(renderedBuffer.getChannelData(0));
  const right = new Float32Array(renderedBuffer.getChannelData(1));

  // Cleanup
  superdoughMod.resetGlobalEffects();
  audioContextMod.setAudioContext(null as unknown);
  superdoughMod.setSuperdoughAudioController(null as unknown);

  return { left, right };
}
