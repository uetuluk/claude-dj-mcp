/**
 * stream-manager.ts — Pre-rendered PCM buffer + MP3 broadcast to connected listeners.
 *
 * Manages:
 * - Connected HTTP clients (ServerResponse objects)
 * - Pre-rendering entire patterns to PCM buffers upfront
 * - Playback loop: reads small chunks from the buffer, mixes TTS, encodes MP3, broadcasts
 * - Pattern switching: pre-render new buffer → atomically swap
 * - CPS (tempo) control
 * - TTS audio mixing (DJ announcements mixed into the stream)
 */

import http from "node:http";
import { renderChunk, SAMPLE_RATE } from "./audio-engine.js";
import { Mp3StreamEncoder } from "./mp3-encoder.js";
import { log } from "./logger.js";

// Duration in seconds per playback chunk.
// Since we're just reading from a pre-rendered buffer (memcpy + encode),
// this is no longer CPU-bound. 2s keeps latency reasonable.
const CHUNK_DURATION = 2.0;

// Duration of the pre-rendered loop buffer in seconds.
const BUFFER_DURATION = 30.0;

// ── State ────────────────────────────────────────────────────────────

let currentPattern: unknown = null;
let currentCps = 0.5;
let isPlaying = false;
let renderLoopTimer: ReturnType<typeof setTimeout> | null = null;

// Pre-rendered PCM loop buffer
let pcmBuffer: { left: Float32Array; right: Float32Array } | null = null;
let bufferPosition = 0; // current sample offset into pcmBuffer

const clients = new Set<http.ServerResponse>();
let encoder: Mp3StreamEncoder = new Mp3StreamEncoder();

// TTS audio queue: PCM Float32 stereo buffers to mix into upcoming chunks
const ttsQueue: Array<{ left: Float32Array; right: Float32Array }> = [];
let ttsOffset = 0; // how far into the current TTS buffer we've consumed

// ── Public API ───────────────────────────────────────────────────────

export function getListenerCount(): number {
  return clients.size;
}

export function getCps(): number {
  return currentCps;
}

export function getIsPlaying(): boolean {
  return isPlaying;
}

/**
 * Set a new pattern and pre-render it to a PCM buffer.
 * Blocks during rendering (~7-12s on VPS). Starts playback loop if not running.
 */
export async function setPattern(pattern: unknown, cps: number): Promise<void> {
  currentPattern = pattern;
  currentCps = cps;

  // Pre-render the entire pattern to a PCM buffer
  const cyclesToRender = cps * BUFFER_DURATION;
  log.info(`Pre-rendering ${BUFFER_DURATION}s of audio (${cyclesToRender.toFixed(1)} cycles at ${cps} CPS)...`);

  const startTime = Date.now();
  const result = await renderChunk(pattern, 0, cyclesToRender, cps);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.info(`Pre-render complete in ${elapsed}s (${result.left.length} samples)`);

  // Atomically swap the buffer
  pcmBuffer = result;
  bufferPosition = 0;

  if (!isPlaying) {
    start();
  }
}

/**
 * Update the tempo (cycles per second).
 * If a pattern is currently playing, re-renders at the new tempo.
 */
export async function setCps(cps: number): Promise<void> {
  currentCps = cps;
  if (currentPattern && isPlaying) {
    // Re-render current pattern at new tempo
    await setPattern(currentPattern, cps);
  }
}

/**
 * Start the playback loop.
 */
export function start(): void {
  if (isPlaying) return;
  isPlaying = true;
  encoder = new Mp3StreamEncoder();
  scheduleNextChunk();
  log.info("Stream started");
}

/**
 * Stop playback. Sends silence and stops the playback loop.
 */
export function stop(): void {
  isPlaying = false;
  currentPattern = null;
  pcmBuffer = null;
  bufferPosition = 0;
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
 * The audio will be mixed on top of the music in subsequent playback cycles.
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
 * Read a chunk from the pre-rendered PCM buffer, mix TTS, encode to MP3, broadcast.
 */
async function playAndBroadcast(): Promise<void> {
  if (!isPlaying) return;

  try {
    const chunkSamples = Math.ceil(CHUNK_DURATION * SAMPLE_RATE);
    let left: Float32Array;
    let right: Float32Array;

    if (pcmBuffer) {
      left = new Float32Array(chunkSamples);
      right = new Float32Array(chunkSamples);
      const bufLen = pcmBuffer.left.length;

      // Copy from circular buffer
      for (let i = 0; i < chunkSamples; i++) {
        const srcIdx = (bufferPosition + i) % bufLen;
        left[i] = pcmBuffer.left[srcIdx];
        right[i] = pcmBuffer.right[srcIdx];
      }
      bufferPosition = (bufferPosition + chunkSamples) % bufLen;
    } else {
      // No buffer: silence
      left = new Float32Array(chunkSamples);
      right = new Float32Array(chunkSamples);
    }

    // Mix TTS audio on top
    mixTts(left, right);

    // Encode to MP3 and broadcast
    const mp3Data = encoder.encodeChunk(left, right);
    broadcast(mp3Data);
  } catch (err) {
    log.error(
      "Playback error:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Schedule next chunk
  scheduleNextChunk();
}

/**
 * Schedule the next playback chunk.
 * Since playback is just memcpy + encode (~5ms), a simple setTimeout suffices.
 */
function scheduleNextChunk(): void {
  if (!isPlaying) return;

  renderLoopTimer = setTimeout(() => {
    playAndBroadcast().catch((err) => {
      log.error("Unhandled playback error:", err instanceof Error ? err.message : String(err));
      scheduleNextChunk();
    });
  }, CHUNK_DURATION * 1000);
}
