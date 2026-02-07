/**
 * stream-manager.ts — Render loop + MP3 broadcast to connected listeners.
 *
 * Manages:
 * - Connected HTTP clients (ServerResponse objects)
 * - Continuous render loop: every ~2s, renders the next chunk of the current pattern,
 *   encodes to MP3, and writes to all connected clients
 * - Pattern switching with short crossfade
 * - CPS (tempo) control
 * - TTS audio mixing (DJ announcements mixed into the stream)
 */

import http from "node:http";
import { renderChunk, SAMPLE_RATE } from "./audio-engine.js";
import { Mp3StreamEncoder } from "./mp3-encoder.js";
import { log } from "./logger.js";

// Duration in seconds per render chunk.
// Larger chunks reduce per-chunk overhead (OfflineAudioContext creation,
// superdough init) at the cost of higher latency. On a 2-vCPU VPS the
// render barely keeps up at 0.5s — 2s gives much more headroom.
const CHUNK_DURATION = 2.0;

// ── State ────────────────────────────────────────────────────────────

let currentPattern: unknown = null;
let currentCps = 0.5;
let cyclePosition = 0;
let isPlaying = false;
let renderLoopTimer: ReturnType<typeof setTimeout> | null = null;

const clients = new Set<http.ServerResponse>();
let encoder: Mp3StreamEncoder = new Mp3StreamEncoder();

// TTS audio queue: PCM Float32 stereo buffers to mix into upcoming chunks
const ttsQueue: Array<{ left: Float32Array; right: Float32Array }> = [];
let ttsOffset = 0; // how far into the current TTS buffer we've consumed

// Buffer-ahead scheduling: render chunks as fast as possible until we're
// BUFFER_AHEAD_MS ahead of real-time, then pace to avoid runaway CPU usage.
let streamStartTime = 0;
let totalAudioSent = 0;
const BUFFER_AHEAD_MS = 6000;

// ── Public API ───────────────────────────────────────────────────────

export function getListenerCount(): number {
  return clients.size;
}

export function getCyclePosition(): number {
  return cyclePosition;
}

export function getCps(): number {
  return currentCps;
}

export function getIsPlaying(): boolean {
  return isPlaying;
}

/**
 * Set a new pattern. Starts the render loop if not running.
 */
export function setPattern(pattern: unknown): void {
  currentPattern = pattern;
  if (!isPlaying) {
    start();
  }
}

/**
 * Update the tempo (cycles per second).
 */
export function setCps(cps: number): void {
  currentCps = cps;
}

/**
 * Start the render loop.
 */
export function start(): void {
  if (isPlaying) return;
  isPlaying = true;
  encoder = new Mp3StreamEncoder();
  streamStartTime = 0;
  totalAudioSent = 0;
  scheduleNextChunk();
  log.info("Stream started");
}

/**
 * Stop playback. Sends silence and stops the render loop.
 */
export function stop(): void {
  isPlaying = false;
  currentPattern = null;
  if (renderLoopTimer) {
    clearTimeout(renderLoopTimer);
    renderLoopTimer = null;
  }
  // Send a short silence chunk so clients don't stall
  const silence = new Float32Array(SAMPLE_RATE * 0.5);
  const mp3 = encoder.encodeChunk(silence, silence);
  const flushed = encoder.flush();
  broadcast(mp3);
  broadcast(flushed);
  log.info("Stream stopped");
}

/**
 * Register a new listener client. Writes MP3 headers/initial data.
 */
export function addClient(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  clients.add(res);
  log.info(`Listener connected (total: ${clients.size})`);

  res.on("close", () => {
    clients.delete(res);
    log.info(`Listener disconnected (total: ${clients.size})`);
  });
}

/**
 * Queue TTS audio (PCM Float32 stereo) for mixing into the stream.
 * The audio will be mixed on top of the music in subsequent render cycles.
 */
export function mixTtsAudio(left: Float32Array, right: Float32Array): void {
  ttsQueue.push({ left, right });
  // Don't reset ttsOffset here — a previous entry may still be mid-playback.
  // ttsOffset is reset to 0 in mixTts() when an entry is fully consumed.
  log.debug(`TTS audio queued (${left.length} samples, queue depth: ${ttsQueue.length})`);
}

// ── Internal ─────────────────────────────────────────────────────────

/**
 * Broadcast MP3 data to all connected clients.
 */
function broadcast(data: Buffer): void {
  if (data.length === 0) return;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

/**
 * Mix TTS audio into a rendered PCM buffer (in-place).
 * Ducks the music volume to ~50% while speech is playing.
 */
function mixTts(
  left: Float32Array,
  right: Float32Array
): void {
  if (ttsQueue.length === 0) return;

  let outputIdx = 0;
  const totalSamples = left.length;

  while (outputIdx < totalSamples && ttsQueue.length > 0) {
    const tts = ttsQueue[0];
    const ttsRemaining = tts.left.length - ttsOffset;
    const toMix = Math.min(ttsRemaining, totalSamples - outputIdx);

    for (let i = 0; i < toMix; i++) {
      const duckFactor = 0.4; // reduce music while speech plays
      const speechGain = 1.2; // boost speech slightly
      left[outputIdx + i] =
        left[outputIdx + i] * duckFactor +
        tts.left[ttsOffset + i] * speechGain;
      right[outputIdx + i] =
        right[outputIdx + i] * duckFactor +
        tts.right[ttsOffset + i] * speechGain;
    }

    ttsOffset += toMix;
    outputIdx += toMix;

    if (ttsOffset >= tts.left.length) {
      ttsQueue.shift();
      ttsOffset = 0;
    }
  }
}

/**
 * Render one chunk, encode to MP3, broadcast, and schedule the next.
 */
async function renderAndBroadcast(): Promise<void> {
  if (!isPlaying) return;

  try {
    const cycleStart = cyclePosition;
    const cycleDuration = currentCps * CHUNK_DURATION;
    const cycleEnd = cycleStart + cycleDuration;

    let left: Float32Array;
    let right: Float32Array;

    if (currentPattern) {
      const result = await renderChunk(
        currentPattern,
        cycleStart,
        cycleEnd,
        currentCps
      );
      left = result.left;
      right = result.right;
    } else {
      // No pattern: silence
      const samples = Math.ceil(CHUNK_DURATION * SAMPLE_RATE);
      left = new Float32Array(samples);
      right = new Float32Array(samples);
    }

    // Mix TTS audio on top
    mixTts(left, right);

    // Encode to MP3
    const mp3Data = encoder.encodeChunk(left, right);
    broadcast(mp3Data);

    // Advance cycle position and track total audio sent
    cyclePosition = cycleEnd;
    totalAudioSent += CHUNK_DURATION;
  } catch (err) {
    log.error(
      "Render error:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Schedule next chunk
  scheduleNextChunk();
}

function scheduleNextChunk(): void {
  if (!isPlaying) return;

  // Calculate how far ahead of real-time our audio buffer is.
  // If we've sent more audio than wall-clock elapsed, we're ahead.
  const now = Date.now();
  if (streamStartTime === 0) streamStartTime = now;
  const wallElapsed = (now - streamStartTime) / 1000;
  const aheadBy = (totalAudioSent - wallElapsed) * 1000; // ms

  // If we're far enough ahead, wait before rendering the next chunk.
  // Otherwise render immediately to build up buffer.
  const delay = aheadBy > BUFFER_AHEAD_MS ? aheadBy - BUFFER_AHEAD_MS : 0;

  renderLoopTimer = setTimeout(() => {
    renderAndBroadcast().catch((err) => {
      log.error("Unhandled render error:", err instanceof Error ? err.message : String(err));
      scheduleNextChunk();
    });
  }, Math.max(delay, 10));
}
