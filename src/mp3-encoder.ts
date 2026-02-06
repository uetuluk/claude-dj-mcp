/**
 * mp3-encoder.ts — Wraps lamejs Mp3Encoder for chunked MP3 streaming.
 *
 * Converts Float32 stereo PCM → Int16 → MP3 frames.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import vm from "node:vm";

// lamejs individual src/js/ files have broken scoping (variables referenced
// without require). The bundled lame.all.js works because everything shares
// one closure. Load it via vm to extract Mp3Encoder.
const require = createRequire(import.meta.url);
const lamejsDir = dirname(require.resolve("lamejs/package.json"));
const bundleSrc = readFileSync(join(lamejsDir, "lame.all.js"), "utf8");
const sandbox: Record<string, any> = {};
vm.runInNewContext(bundleSrc, sandbox);
const lamejs = sandbox.lamejs as {
  Mp3Encoder: new (
    channels: number,
    sampleRate: number,
    kbps: number
  ) => {
    encodeBuffer(left: Int16Array, right: Int16Array): Int8Array;
    flush(): Int8Array;
  };
};

const SAMPLE_RATE = 44100;
const KBPS = 128;
const CHANNELS = 2;

export class Mp3StreamEncoder {
  private encoder: InstanceType<typeof lamejs.Mp3Encoder>;

  constructor(
    sampleRate: number = SAMPLE_RATE,
    kbps: number = KBPS
  ) {
    this.encoder = new lamejs.Mp3Encoder(CHANNELS, sampleRate, kbps);
  }

  /**
   * Encode a stereo PCM chunk (Float32 [-1, 1]) to MP3 frames.
   * Returns a Buffer of MP3 data (may be empty if lamejs is buffering).
   */
  encodeChunk(left: Float32Array, right: Float32Array): Buffer {
    const samples = left.length;
    const leftInt16 = new Int16Array(samples);
    const rightInt16 = new Int16Array(samples);

    for (let i = 0; i < samples; i++) {
      // Clamp and convert Float32 → Int16
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      leftInt16[i] = l < 0 ? l * 0x8000 : l * 0x7fff;
      rightInt16[i] = r < 0 ? r * 0x8000 : r * 0x7fff;
    }

    const mp3Data: Int8Array = this.encoder.encodeBuffer(
      leftInt16,
      rightInt16
    );

    return Buffer.from(mp3Data.buffer, mp3Data.byteOffset, mp3Data.byteLength);
  }

  /**
   * Flush any remaining MP3 data from the encoder.
   */
  flush(): Buffer {
    const mp3Data: Int8Array = this.encoder.flush();
    return Buffer.from(mp3Data.buffer, mp3Data.byteOffset, mp3Data.byteLength);
  }
}
