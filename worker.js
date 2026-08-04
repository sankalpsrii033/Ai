/**
 * Stockfish Worker Bridge
 * Place stockfish.js and stockfish.wasm in the same directory as this file.
 *
 * Usage from main thread:
 *   const worker = new Worker('./worker.js');
 *   worker.postMessage({ type: 'init' });
 *   worker.postMessage({ type: 'cmd', data: 'position startpos' });
 *   worker.postMessage({ type: 'cmd', data: 'go depth 12' });
 *   worker.onmessage = (e) => { ... e.data.type === 'bestmove' ... }
 */

let engine = null;
let queue = [];

function createEngine() {
  try {
    // Preferred: stockfish.js exposes STOCKFISH() factory when imported in worker
    importScripts('./stockfish.js');
  } catch (err) {
    self.postMessage({ type: 'error', message: 'importScripts(stockfish.js) failed: ' + err.message });
    return;
  }

  try {
    if (typeof STOCKFISH === 'function') {
      engine = STOCKFISH();
    } else {
      // Some builds register onmessage on the global worker scope itself
      self.postMessage({ type: 'error', message: 'STOCKFISH() not found after loading stockfish.js. Try using new Worker("stockfish.js") directly from main thread.' });
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: 'STOCKFISH() failed: ' + err.message });
    return;
  }

  engine.onmessage = function (line) {
    const text = (typeof line === 'string') ? line : (line && line.data != null ? line.data : String(line));
    onEngineLine(text);
  };

  // flush queued commands
  queue.forEach(cmd => engine.postMessage(cmd));
  queue = [];

  engine.postMessage('uci');
}

function onEngineLine(line) {
  if (!line) return;
  self.postMessage({ type: 'line', data: line });

  if (line.indexOf('uciok') !== -1) {
    self.postMessage({ type: 'uciok' });
  }
  if (line.indexOf('readyok') !== -1) {
    self.postMessage({ type: 'readyok' });
  }
  if (line.indexOf('bestmove') === 0) {
    const parts = line.split(/\s+/);
    self.postMessage({
      type: 'bestmove',
      bestmove: parts[1] || null,
      ponder: (parts[2] === 'ponder' ? parts[3] : null) || null,
      raw: line
    });
  }
}

self.onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type === 'init') {
    if (!engine) createEngine();
    return;
  }
  if (msg.type === 'cmd') {
    if (engine) engine.postMessage(msg.data);
    else queue.push(msg.data);
    return;
  }
  if (msg.type === 'quit') {
    if (engine) engine.postMessage('quit');
  }
};

// Auto-start
createEngine();
