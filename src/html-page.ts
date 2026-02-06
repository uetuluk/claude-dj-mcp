/**
 * html-page.ts — Listener UI for the network radio station.
 *
 * Features:
 * - <audio> element for MP3 stream playback
 * - "Tune In" button (satisfies mobile autoplay policy)
 * - <strudel-editor> in read-only display mode for pattern visualization
 *   - getTime() uses a synthetic clock synced via /api/status polling
 *   - Audio output is a no-op (actual audio comes from the MP3 stream)
 * - BPM, listener count, connection status display
 * - Request bar for song/vibe requests to the DJ
 */

export function getHtmlPage(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude DJ Radio</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #header {
      background: linear-gradient(135deg, #1a0a2e, #16213e);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #6c3ce0;
    }
    #header h1 {
      font-size: 1.3em;
      background: linear-gradient(90deg, #a855f7, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    #status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85em;
    }
    #status .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #555;
      transition: background 0.3s;
    }
    #status .dot.connected { background: #22c55e; }
    #status .dot.playing { background: #a855f7; animation: pulse 1s infinite; }
    #status .dot.error { background: #ef4444; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    #tune-in-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 16px;
      gap: 16px;
    }
    #tune-in-btn {
      padding: 14px 36px;
      font-size: 1.1em;
      font-family: 'Courier New', monospace;
      background: linear-gradient(135deg, #a855f7, #6366f1);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #tune-in-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.5);
    }
    #tune-in-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    #listener-badge {
      background: #1a1a2e;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 0.85em;
      color: #a855f7;
    }
    #editor-container {
      flex: 1;
      padding: 0;
      min-height: 300px;
    }
    strudel-editor {
      display: block;
      width: 100%;
      min-height: 300px;
    }
    #request-bar {
      background: #111;
      border-top: 2px solid #333;
      padding: 10px 20px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    #request-bar label {
      font-size: 0.85em;
      color: #a855f7;
      white-space: nowrap;
    }
    #request-input {
      flex: 1;
      padding: 8px 12px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      background: #1a1a2e;
      color: #e0e0e0;
      border: 1px solid #333;
      border-radius: 4px;
      outline: none;
    }
    #request-input:focus {
      border-color: #a855f7;
    }
    #request-input::placeholder {
      color: #555;
    }
    #send-request-btn {
      padding: 8px 16px;
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    #send-request-btn:hover {
      background: #818cf8;
    }
    #footer {
      background: #111;
      padding: 6px 20px;
      display: flex;
      justify-content: space-between;
      font-size: 0.75em;
      color: #555;
      border-top: 1px solid #222;
    }
    #request-toast {
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: #22c55e;
      color: #000;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 0.85em;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    #request-toast.show {
      opacity: 1;
    }
  </style>
</head>
<body>
  <div id="header">
    <h1>Claude DJ Radio</h1>
    <div id="status">
      <div class="dot" id="status-dot"></div>
      <span id="status-text">Connecting...</span>
    </div>
  </div>

  <div id="tune-in-container">
    <button id="tune-in-btn">Tune In</button>
    <div id="listener-badge">Listeners: --</div>
  </div>

  <!-- Hidden audio element for the MP3 stream -->
  <audio id="radio" src="/stream" preload="none"></audio>

  <div id="editor-container">
    <strudel-editor id="strudel-repl">
<!--
// Claude DJ Radio - Listening...
// The DJ is crafting something...
-->
    </strudel-editor>
  </div>

  <div id="request-bar">
    <label>Request a song/vibe:</label>
    <input type="text" id="request-input" placeholder="e.g. something funky, chill lo-fi beats, 90s techno..." />
    <button id="send-request-btn">Send to DJ</button>
  </div>

  <div id="footer">
    <span id="footer-bpm">BPM: --</span>
    <span id="footer-state">Waiting</span>
    <span id="footer-connection">Connecting...</span>
  </div>

  <div id="request-toast">Request sent!</div>

  <script src="https://unpkg.com/@strudel/repl@latest"></script>
  <script>
    const BASE_URL = window.location.origin;
    const STATUS_POLL_INTERVAL = 2000;

    // Synthetic clock for Strudel visualization
    let baseCycle = 0;
    let baseTime = 0;
    let currentCps = 0.5;
    let tunedIn = false;
    let connected = false;
    let lastCode = '';

    const audio = document.getElementById('radio');
    const tuneInBtn = document.getElementById('tune-in-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const listenerBadge = document.getElementById('listener-badge');
    const requestInput = document.getElementById('request-input');
    const sendRequestBtn = document.getElementById('send-request-btn');
    const footerBpm = document.getElementById('footer-bpm');
    const footerState = document.getElementById('footer-state');
    const footerConnection = document.getElementById('footer-connection');
    const toast = document.getElementById('request-toast');

    function getStrudelMirror() {
      const el = document.getElementById('strudel-repl');
      return el && el.editor ? el.editor : null;
    }

    function updateStatus(state, text) {
      statusDot.className = 'dot ' + state;
      statusText.textContent = text;
    }

    // Tune In button
    tuneInBtn.addEventListener('click', () => {
      tuneInBtn.disabled = true;
      tuneInBtn.textContent = 'Tuning in...';
      audio.play().then(() => {
        tunedIn = true;
        tuneInBtn.textContent = 'Listening';
        updateStatus('playing', 'On Air');
        footerState.textContent = 'Listening';
      }).catch((e) => {
        console.error('Audio play failed:', e);
        tuneInBtn.disabled = false;
        tuneInBtn.textContent = 'Tune In (retry)';
        updateStatus('error', 'Playback error');
      });
    });

    // Request handling
    function sendRequest() {
      const text = requestInput.value.trim();
      if (!text) return;

      fetch(BASE_URL + '/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      }).then(() => {
        requestInput.value = '';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }).catch(err => console.error('Failed to send request:', err));
    }

    sendRequestBtn.addEventListener('click', sendRequest);
    requestInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendRequest();
    });

    // Poll /api/status for metadata and visualization sync
    async function pollStatus() {
      try {
        const res = await fetch(BASE_URL + '/api/status');
        if (!res.ok) return;
        const data = await res.json();

        if (!connected) {
          connected = true;
          footerConnection.textContent = 'Connected';
          if (!tunedIn) {
            updateStatus('connected', 'Connected - Click Tune In');
          }
        }

        // Update sync clock
        baseCycle = data.cyclePosition || 0;
        baseTime = performance.now();
        currentCps = data.cps || 0.5;

        // Update UI
        footerBpm.textContent = 'BPM: ' + (data.bpm || '--');
        listenerBadge.textContent = 'Listeners: ' + (data.listenerCount || 0);

        if (data.playing) {
          if (tunedIn) {
            updateStatus('playing', 'On Air');
            footerState.textContent = 'Listening';
          }
        } else {
          updateStatus('connected', 'DJ is silent');
          footerState.textContent = 'Waiting for DJ';
        }

        // Update Strudel editor visualization if code changed
        if (data.currentCode && data.currentCode !== lastCode) {
          lastCode = data.currentCode;
          const mirror = getStrudelMirror();
          if (mirror) {
            try {
              mirror.setCode(data.currentCode);
              // Evaluate to update visualization (audio output is no-op)
              await mirror.evaluate(true);
            } catch (e) {
              // Visualization errors are non-critical
              console.debug('Viz update error:', e);
            }
          }
        }
      } catch (e) {
        if (connected) {
          connected = false;
          footerConnection.textContent = 'Disconnected';
          updateStatus('error', 'Connection lost');
        }
      }
    }

    // Start polling
    setInterval(pollStatus, STATUS_POLL_INTERVAL);
    pollStatus();
  </script>
</body>
</html>`;
}
