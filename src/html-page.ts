export function getHtmlPage(sessionId: string, port: number): string {
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
    #header .session-info {
      font-size: 0.8em;
      color: #888;
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
    #start-audio-container {
      display: flex;
      justify-content: center;
      padding: 20px;
    }
    #start-audio-btn {
      padding: 16px 40px;
      font-size: 1.2em;
      font-family: 'Courier New', monospace;
      background: linear-gradient(135deg, #a855f7, #6366f1);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #start-audio-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.5);
    }
    #start-audio-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
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
    <div class="session-info">Session: ${sessionId}</div>
  </div>

  <div id="start-audio-container">
    <button id="start-audio-btn">Start Audio</button>
  </div>

  <div id="editor-container">
    <strudel-editor id="strudel-repl">
// Welcome to Claude DJ Radio!
// Click "Start Audio" above, then the DJ will take over.
s("bd sd:1 hh sd:2").gain(0.8)
    </strudel-editor>
  </div>

  <div id="request-bar">
    <label>Request a song/vibe:</label>
    <input type="text" id="request-input" placeholder="e.g. something funky, chill lo-fi beats, 90s techno..." />
    <button id="send-request-btn">Send to DJ</button>
  </div>

  <div id="footer">
    <span id="footer-bpm">BPM: --</span>
    <span id="footer-state">Stopped</span>
    <span id="footer-connection">Disconnected</span>
  </div>

  <div id="request-toast">Request sent!</div>

  <script src="https://unpkg.com/@strudel/repl@latest"></script>
  <script>
    const SESSION_ID = "${sessionId}";
    const BASE_URL = "http://localhost:${port}";
    const POLL_INTERVAL = 1000;

    let lastVersion = 0;
    let audioStarted = false;
    let connected = false;
    let pollTimer = null;

    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const startBtn = document.getElementById('start-audio-btn');
    const requestInput = document.getElementById('request-input');
    const sendRequestBtn = document.getElementById('send-request-btn');
    const footerBpm = document.getElementById('footer-bpm');
    const footerState = document.getElementById('footer-state');
    const footerConnection = document.getElementById('footer-connection');
    const toast = document.getElementById('request-toast');

    function getEditor() {
      const el = document.getElementById('strudel-repl');
      return el ? el : null;
    }

    function updateStatus(state, text) {
      statusDot.className = 'dot ' + state;
      statusText.textContent = text;
    }

    // Start Audio button
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Starting...';
      try {
        const editor = getEditor();
        if (editor) {
          // Evaluate the current code to start Web Audio context
          await editor.evaluate();
          audioStarted = true;
          updateStatus('playing', 'Playing');
          footerState.textContent = 'Playing';
          startBtn.textContent = 'Audio Started';
          // Report state immediately
          reportState();
        }
      } catch (e) {
        console.error('Failed to start audio:', e);
        startBtn.disabled = false;
        startBtn.textContent = 'Start Audio (retry)';
        updateStatus('error', 'Error starting audio');
      }
    });

    // Send request
    function sendRequest() {
      const text = requestInput.value.trim();
      if (!text) return;

      fetch(BASE_URL + '/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, text })
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

    // Report browser state to server
    async function reportState() {
      try {
        const editor = getEditor();
        let cps = 0.5;
        let activeCode = '';
        let error = null;

        if (editor) {
          try {
            // Try to read CPS from the editor/repl
            if (editor.repl && editor.repl.scheduler) {
              cps = editor.repl.scheduler.cps || 0.5;
            }
          } catch (e) { /* ignore */ }

          try {
            activeCode = editor.getCode ? editor.getCode() : '';
          } catch (e) { /* ignore */ }
        }

        await fetch(BASE_URL + '/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: SESSION_ID,
            started: audioStarted,
            activeCode,
            error,
            cps
          })
        });
      } catch (e) {
        // Connection lost
      }
    }

    // Poll for pending actions from MCP server
    async function poll() {
      try {
        const res = await fetch(BASE_URL + '/api/poll?sessionId=' + encodeURIComponent(SESSION_ID));
        if (!res.ok) return;

        const data = await res.json();

        if (!connected) {
          connected = true;
          footerConnection.textContent = 'Connected';
          if (!audioStarted) {
            updateStatus('connected', 'Connected - Click Start Audio');
          }
        }

        // Check for new version with pending action
        if (data.version > lastVersion && data.action) {
          lastVersion = data.version;
          const editor = getEditor();

          if (data.action === 'evaluate' && data.code && editor) {
            try {
              editor.setCode(data.code);
              await editor.evaluate();
              audioStarted = true;
              updateStatus('playing', 'Playing');
              footerState.textContent = 'Playing';
              startBtn.textContent = 'Audio Started';
              startBtn.disabled = true;
            } catch (e) {
              console.error('Evaluate error:', e);
              updateStatus('error', 'Error: ' + (e.message || e));
              // Report error state
              await fetch(BASE_URL + '/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId: SESSION_ID,
                  started: audioStarted,
                  activeCode: data.code,
                  error: e.message || String(e),
                  cps: 0.5
                })
              });
            }
          } else if (data.action === 'stop' && editor) {
            try {
              editor.stop();
              updateStatus('connected', 'Stopped');
              footerState.textContent = 'Stopped';
            } catch (e) {
              console.error('Stop error:', e);
            }
          }
        }

        // Update BPM display
        if (data.cps) {
          const bpm = Math.round(data.cps * 60 * 4);
          footerBpm.textContent = 'BPM: ' + bpm;
        }

        // Always report state back
        await reportState();

      } catch (e) {
        if (connected) {
          connected = false;
          footerConnection.textContent = 'Disconnected';
          updateStatus('error', 'Connection lost');
        }
      }
    }

    // Start polling
    pollTimer = setInterval(poll, POLL_INTERVAL);
    poll(); // Initial poll
  </script>
</body>
</html>`;
}
