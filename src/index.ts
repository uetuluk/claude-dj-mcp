#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { networkInterfaces, platform } from "node:os";
import { log } from "./logger.js";
import {
  startHttpServer,
  getServerPort,
  drainRequests,
  getRadioState,
  setCurrentPatternCode,
} from "./http-server.js";
import {
  setPattern,
  setCps,
  stop as stopStream,
  getListenerCount,
  getCps,
  getIsPlaying,
  getCyclePosition,
  mixTtsAudio,
} from "./stream-manager.js";
import { initEngine, evaluatePattern } from "./audio-engine.js";
import { getSounds } from "./sounds.js";
import { registerPrompts } from "./prompts.js";

const execAsync = promisify(exec);

const server = new McpServer({
  name: "claude-dj",
  version: "0.2.0",
});

// Track whether a session is active
let sessionActive = false;
let sessionId = "";
let sessionUrl = "";

/**
 * Get the first non-internal IPv4 address for LAN access.
 */
function getLanIp(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// --- Tool 1: start_session ---
server.tool(
  "start_session",
  "Start a DJ session: launches HTTP server and initializes the audio engine. Returns stream URL with LAN IP. Anyone on the network can tune in.",
  {},
  async () => {
    try {
      if (sessionActive) {
        return {
          content: [
            {
              type: "text",
              text: `Session already active.\nSession ID: ${sessionId}\nStream URL: ${sessionUrl}\n\nListeners can tune in at: ${sessionUrl}`,
            },
          ],
        };
      }

      // Initialize the audio engine (loads Strudel, registers synth sounds)
      await initEngine();

      const port = await startHttpServer();
      sessionId = `dj-${Date.now().toString(36)}`;
      const lanIp = getLanIp();
      sessionUrl = `http://${lanIp}:${port}`;
      sessionActive = true;

      // Optionally open the listener page in a browser
      try {
        const open = await import("open");
        await open.default(`http://localhost:${port}`);
      } catch {
        // Non-critical if browser doesn't open
      }

      log.info(`Session started: ${sessionId} at ${sessionUrl}`);

      return {
        content: [
          {
            type: "text",
            text: `DJ session started!\n\nSession ID: ${sessionId}\nStream URL: ${sessionUrl}\nLocal URL: http://localhost:${port}\n\nListeners on the LAN can tune in at ${sessionUrl}\nAudio is rendered server-side — no "Start Audio" button needed.\nCall play_pattern to start the music.`,
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error("Failed to start session:", msg);
      return {
        content: [{ type: "text", text: `Error starting session: ${msg}` }],
        isError: true,
      };
    }
  }
);

// --- Tool 2: play_pattern ---
server.tool(
  "play_pattern",
  "Send Strudel pattern code to the browser REPL for evaluation. The code will be set and evaluated in the Strudel editor.",
  {
    code: z
      .string()
      .describe("Strudel pattern code to evaluate (e.g., 's(\"bd sd hh sd\")')"),
  },
  async ({ code }) => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    try {
      const pattern = await evaluatePattern(code);
      setPattern(pattern);
      setCurrentPatternCode(code);

      log.info(`Pattern playing: ${code.substring(0, 80)}`);

      const cps = getCps();
      const bpm = Math.round(cps * 240);

      return {
        content: [
          {
            type: "text",
            text: `Pattern is playing.\nBPM: ${bpm}, CPS: ${cps}, Listeners: ${getListenerCount()}`,
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error("Pattern error:", msg);
      return {
        content: [
          {
            type: "text",
            text: `Pattern evaluation error: ${msg}\n\nTry simplifying the pattern.`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool 3: stop_music ---
server.tool(
  "stop_music",
  "Stop the currently playing Strudel pattern.",
  {},
  async () => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    stopStream();
    setCurrentPatternCode("");
    log.info("Music stopped");

    return {
      content: [
        {
          type: "text",
          text: `Music stopped. Listeners: ${getListenerCount()}`,
        },
      ],
    };
  }
);

// --- Tool 4: get_session_state ---
server.tool(
  "get_session_state",
  "Get the current state of the browser: whether audio is started, active code, errors, and tempo (CPS).",
  {},
  async () => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    const state = getRadioState();
    const bpm = Math.round(state.cps * 240);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              playing: state.isPlaying,
              currentCode: state.currentPatternCode,
              cps: state.cps,
              bpm,
              listenerCount: state.listenerCount,
              cyclePosition: getCyclePosition(),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool 5: set_tempo ---
server.tool(
  "set_tempo",
  "Set the playback tempo. Provide either BPM or CPS (cycles per second). For 4/4 time: CPS = BPM / 240.",
  {
    bpm: z
      .number()
      .min(30)
      .max(300)
      .optional()
      .describe("Beats per minute (30-300)"),
    cps: z
      .number()
      .min(0.1)
      .max(2)
      .optional()
      .describe("Cycles per second (0.1-2.0)"),
  },
  async ({ bpm, cps }) => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    let targetCps: number;
    if (cps !== undefined) {
      targetCps = cps;
    } else if (bpm !== undefined) {
      targetCps = bpm / 240;
    } else {
      return {
        content: [
          { type: "text", text: "Provide either bpm or cps parameter." },
        ],
        isError: true,
      };
    }

    setCps(targetCps);
    const resultBpm = Math.round(targetCps * 240);

    log.info(`Tempo set: ${resultBpm} BPM (${targetCps} CPS)`);

    return {
      content: [
        {
          type: "text",
          text: `Tempo set to ${resultBpm} BPM (${targetCps.toFixed(4)} CPS).`,
        },
      ],
    };
  }
);

// --- Tool 6: dj_speak ---
server.tool(
  "dj_speak",
  "Use text-to-speech to announce over the music. All listeners hear the announcement in the stream. Works on macOS (say) and Linux (espeak-ng).",
  {
    text: z.string().max(500).describe("Text to speak aloud"),
    voice: z
      .string()
      .optional()
      .describe(
        'Voice name. macOS: "Samantha", "Alex", "Daniel". Linux: "en", "en+f3" (espeak-ng voice)'
      ),
    rate: z
      .number()
      .min(100)
      .max(400)
      .optional()
      .describe("Speech rate in words per minute (default: 200)"),
  },
  async ({ text, voice, rate }) => {
    const escaped = text.replace(/'/g, "'\\''");
    const tmpDir = "/tmp";
    const ts = Date.now();
    const wavPath = `${tmpDir}/dj-tts-${ts}.wav`;

    log.info(`Speaking (to stream): "${text.substring(0, 50)}..."`);

    try {
      if (platform() === "darwin") {
        // macOS: say → AIFF → afconvert → WAV
        const aiffPath = `${tmpDir}/dj-tts-${ts}.aiff`;
        let sayCmd = `say -o '${aiffPath}'`;
        if (voice) {
          const escapedVoice = voice.replace(/'/g, "'\\''");
          sayCmd += ` -v '${escapedVoice}'`;
        }
        if (rate) {
          sayCmd += ` -r ${Math.round(rate)}`;
        }
        sayCmd += ` '${escaped}'`;

        await execAsync(sayCmd);
        await execAsync(
          `afconvert -d LEI16@44100 -c 2 -f WAVE '${aiffPath}' '${wavPath}'`
        );
        unlink(aiffPath).catch(() => {});
      } else {
        // Linux: espeak-ng outputs WAV directly
        let espeakCmd = `espeak-ng`;
        if (voice) {
          const escapedVoice = voice.replace(/'/g, "'\\''");
          espeakCmd += ` -v '${escapedVoice}'`;
        }
        if (rate) {
          espeakCmd += ` -s ${Math.round(rate)}`;
        }
        espeakCmd += ` -w '${wavPath}' '${escaped}'`;

        await execAsync(espeakCmd);

        // espeak-ng outputs mono 22050Hz — resample to 44100Hz stereo via ffmpeg if available
        const resampledPath = `${tmpDir}/dj-tts-${ts}-resampled.wav`;
        try {
          await execAsync(
            `ffmpeg -y -i '${wavPath}' -ar 44100 -ac 2 '${resampledPath}' 2>/dev/null`
          );
          // Replace the original with the resampled version
          await execAsync(`mv '${resampledPath}' '${wavPath}'`);
        } catch {
          // ffmpeg not available — parseWavPcm will handle mono/different sample rates
          unlink(resampledPath).catch(() => {});
        }
      }

      // Read WAV file and extract PCM data
      const wavBuffer = await readFile(wavPath);
      const pcm = parseWavPcm(wavBuffer);

      // Mix into the stream
      mixTtsAudio(pcm.left, pcm.right);

      // Cleanup
      unlink(wavPath).catch(() => {});

      return {
        content: [
          {
            type: "text",
            text: `Speaking (mixed into stream): "${text}"\nAll listeners will hear the announcement.`,
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.debug("TTS error:", msg);

      // Cleanup on error
      unlink(wavPath).catch(() => {});

      const hint =
        platform() === "darwin"
          ? "macOS 'say' command required"
          : "Linux: install espeak-ng (and optionally ffmpeg for resampling)";

      return {
        content: [
          {
            type: "text",
            text: `TTS failed (${hint}): ${msg}`,
          },
        ],
        isError: true,
      };
    }
  }
);

/**
 * Parse a 16-bit PCM WAV file into stereo Float32 arrays.
 * Handles both mono and stereo input. Mono is duplicated to both channels.
 */
function parseWavPcm(buffer: Buffer): {
  left: Float32Array;
  right: Float32Array;
} {
  // Parse WAV header for channel count
  const numChannels = buffer.readUInt16LE(22);

  // Find the "data" chunk
  let dataOffset = 44; // default WAV header size
  let dataLength = buffer.length - 44;

  for (let i = 0; i < buffer.length - 8; i++) {
    if (
      buffer[i] === 0x64 && // 'd'
      buffer[i + 1] === 0x61 && // 'a'
      buffer[i + 2] === 0x74 && // 't'
      buffer[i + 3] === 0x61 // 'a'
    ) {
      dataLength = buffer.readUInt32LE(i + 4);
      dataOffset = i + 8;
      break;
    }
  }

  const bytesPerFrame = 2 * numChannels; // 16-bit per channel
  const numFrames = Math.floor(dataLength / bytesPerFrame);
  const left = new Float32Array(numFrames);
  const right = new Float32Array(numFrames);

  if (numChannels >= 2) {
    // Stereo (or more) — use first two channels
    for (let i = 0; i < numFrames; i++) {
      const offset = dataOffset + i * bytesPerFrame;
      if (offset + 3 < buffer.length) {
        left[i] = buffer.readInt16LE(offset) / 32768;
        right[i] = buffer.readInt16LE(offset + 2) / 32768;
      }
    }
  } else {
    // Mono — duplicate to both channels
    for (let i = 0; i < numFrames; i++) {
      const offset = dataOffset + i * 2;
      if (offset + 1 < buffer.length) {
        const sample = buffer.readInt16LE(offset) / 32768;
        left[i] = sample;
        right[i] = sample;
      }
    }
  }

  return { left, right };
}

// --- Tool 7: check_requests ---
server.tool(
  "check_requests",
  "Check for pending user requests submitted via the browser UI. Drains the queue.",
  {},
  async () => {
    const requests = drainRequests();

    if (requests.length === 0) {
      return {
        content: [{ type: "text", text: "No pending requests." }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `${requests.length} pending request(s):\n${requests
            .map((r, i) => `${i + 1}. "${r.text}" (${r.timestamp})`)
            .join("\n")}`,
        },
      ],
    };
  }
);

// --- Tool 8: wait ---
server.tool(
  "wait",
  "Wait for a specified number of seconds (letting the music play), then return any pending user requests. This is the core DJ loop tool.",
  {
    seconds: z
      .number()
      .min(1)
      .max(300)
      .describe("Number of seconds to wait (1-300)"),
  },
  async ({ seconds }) => {
    log.debug(`Waiting ${seconds}s...`);

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    const requests = drainRequests();
    const cps = getCps();
    const bpm = Math.round(cps * 240);
    const listeners = getListenerCount();

    let text = `Waited ${seconds} seconds.\n`;
    text += `Playing: ${getIsPlaying()}, BPM: ${bpm}, Listeners: ${listeners}`;

    if (requests.length > 0) {
      text += `\n\n${requests.length} pending request(s):\n`;
      text += requests
        .map((r, i) => `${i + 1}. "${r.text}" (${r.timestamp})`)
        .join("\n");
    } else {
      text += "\n\nNo pending requests.";
    }

    return {
      content: [{ type: "text", text }],
    };
  }
);

// --- Tool 9: get_available_sounds ---
server.tool(
  "get_available_sounds",
  "Get a curated list of available Strudel sounds, organized by category.",
  {
    category: z
      .enum(["drums", "synths", "instruments", "effects", "all"])
      .optional()
      .describe("Sound category to list (default: all)"),
  },
  async ({ category }) => {
    return {
      content: [{ type: "text", text: getSounds(category) }],
    };
  }
);

// --- Register prompts ---
registerPrompts(server);

// --- Main ---
async function main() {
  log.info("Claude DJ MCP server starting...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server connected via stdio");
}

main().catch((error) => {
  log.error("Fatal error:", error);
  process.exit(1);
});
