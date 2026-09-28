const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { existsSync, mkdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { app } = require('electron');

/**
 * NDJSON supervisor for aptek-pos-core — mirrors Restaurant POS process lifecycle.
 *
 * Bounded like the Restaurant contract (shared/contracts/protocol.json): a frame
 * may not exceed MAX_MESSAGE_BYTES in either direction, at most MAX_PENDING
 * requests wait for an answer, and writes queue behind stdin backpressure
 * instead of piling up inside the pipe.
 */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING = 200;
class CoreSupervisor extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.state = 'stopped';
    this.pending = new Map();
    this.buffer = '';
    this.writeQueue = [];
    this.writeBlocked = false;
    this.restartAttempts = 0;
    this.stopping = false;
    this.dbPath = null;
    this.logDir = null;
    this.customerId = '_default';
  }

  resolveCorePath() {
    if (process.env.APTEK_POS_CORE_PATH && existsSync(process.env.APTEK_POS_CORE_PATH)) {
      return process.env.APTEK_POS_CORE_PATH;
    }
    const packaged = path.join(process.resourcesPath || '', 'native', 'win32-x64', 'aptek-pos-core.exe');
    if (existsSync(packaged)) return packaged;
    const root = path.resolve(__dirname, '..');
    const linux = path.join(root, 'native', 'build', 'aptek-pos-core');
    const win = path.join(root, 'native', 'build', 'aptek-pos-core.exe');
    if (existsSync(linux)) return linux;
    if (existsSync(win)) return win;
    return null;
  }

  resolvePaths(customerId = '_default') {
    const userData = app.getPath('userData');
    const safeId = String(customerId || '_default').replace(/[^a-zA-Z0-9_-]/g, '_');
    this.dbPath = process.env.APTEK_POS_DB_PATH || path.join(userData, 'data', 'tenants', safeId, 'aptek.db');
    this.logDir = process.env.APTEK_POS_LOG_DIR || path.join(userData, 'logs');
    mkdirSync(path.dirname(this.dbPath), { recursive: true });
    mkdirSync(this.logDir, { recursive: true });
  }

  setState(next) {
    this.state = next;
    this.emit('status', { state: next, dbPath: this.dbPath });
  }

  async start(customerId) {
    this.stopping = false;
    // Remembered so a crash restart reopens the same shop's database, not the
    // empty _default one - that swapped the till's data out from under it.
    this.customerId = customerId || this.customerId || '_default';
    this.resolvePaths(this.customerId);
    const corePath = this.resolveCorePath();
    if (!corePath) {
      this.setState('crashed');
      throw new Error('aptek-pos-core binary not found — run npm run market:build:core');
    }
    this.setState('starting');
    await new Promise((resolve, reject) => {
      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        this.off('event', waitReady);
        clearTimeout(timer);
        this.restartAttempts = 0;
        this.setState('ready');
        resolve();
      };
      const waitReady = (evt) => {
        if (evt?.event === 'core.ready') onReady();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.off('event', waitReady);
        reject(new Error('aptek-pos-core ready timeout'));
      }, 20000);
      this.on('event', waitReady);

      this.child = spawn(corePath, ['--db', this.dbPath, '--log-dir', this.logDir, '--protocol', '1'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        cwd: path.dirname(corePath),
        env: { ...process.env, APTEK_POS_LOG_LEVEL: app.isPackaged ? 'info' : 'debug' },
      });
      this.writeQueue = [];
      this.writeBlocked = false;
      this.child.stdin.on('drain', () => this.flushWrites());
      this.child.stdin.on('error', () => { /* surfaced through exit */ });
      this.child.stdout.setEncoding('utf8');
      this.child.stderr.setEncoding('utf8');
      this.child.stdout.on('data', (chunk) => this.onStdout(chunk));
      this.child.stderr.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) console.error('[market-core]', line);
        }
      });
      this.child.on('exit', (code, signal) => this.onExit(code, signal));
      this.child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.off('event', waitReady);
          reject(err);
        }
      });
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
        this.protocolFailure('oversized frame');
        return;
      }
      let doc;
      try {
        doc = JSON.parse(line);
      } catch {
        console.error('[market-core] bad frame', line.slice(0, 200));
        continue;
      }
      if (doc.type === 'event') {
        this.emit('event', doc);
        continue;
      }
      const pending = this.pending.get(doc.requestId);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(doc.requestId);
      pending.resolve(doc);
    }
    // A partial frame may never grow without bound: a core that stops writing
    // newlines is broken, and is restarted rather than allowed to eat memory.
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_MESSAGE_BYTES) this.protocolFailure('unterminated frame');
  }

  protocolFailure(reason) {
    console.error('[market-core] protocol failure:', reason);
    this.buffer = '';
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        requestId: pending.requestId,
        success: false,
        data: null,
        error: { code: 'E_PROTOCOL', message: `aptek-pos-core ${reason}`, retryable: true },
      });
    }
    this.pending.clear();
    try { this.child?.kill(); } catch { /* exit handler restarts */ }
  }

  writeFrame(frame) {
    if (this.writeBlocked) {
      this.writeQueue.push(frame);
      return;
    }
    if (!this.child.stdin.write(frame)) this.writeBlocked = true;
  }

  flushWrites() {
    this.writeBlocked = false;
    while (this.writeQueue.length > 0 && this.child && !this.writeBlocked) {
      if (!this.child.stdin.write(this.writeQueue.shift())) this.writeBlocked = true;
    }
  }

  onExit(code, signal) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        requestId: pending.requestId,
        success: false,
        data: null,
        error: { code: 'E_CORE_DOWN', message: 'aptek-pos-core exited', retryable: true },
      });
    }
    this.pending.clear();
    this.writeQueue = [];
    this.writeBlocked = false;
    this.buffer = '';
    this.child = null;
    if (this.stopping) {
      this.setState('stopped');
      return;
    }
    this.setState('crashed');
    if (this.restartAttempts >= 3) return;
    this.restartAttempts += 1;
    this.setState('restarting');
    setTimeout(() => {
      this.start(this.customerId).catch((err) => console.error('[market-core] restart failed', err));
    }, 1000 * this.restartAttempts);
  }

  invoke(method, payload = {}, timeoutMs = 15000) {
    if (!this.child || !this.child.stdin.writable || this.state !== 'ready') {
      return Promise.resolve({
        success: false,
        data: null,
        error: { code: 'E_CORE_DOWN', message: `core not ready (${this.state})`, retryable: true },
      });
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.resolve({
        success: false,
        data: null,
        error: { code: 'E_QUEUE_FULL', message: 'Too many pending core requests', retryable: true },
      });
    }
    const requestId = randomUUID();
    const frame = JSON.stringify({
      requestId,
      method,
      protocolVersion: 1,
      timestamp: Date.now(),
      payload: payload ?? {},
    }) + '\n';
    if (Buffer.byteLength(frame, 'utf8') > MAX_MESSAGE_BYTES) {
      return Promise.resolve({
        requestId,
        success: false,
        data: null,
        error: { code: 'E_PAYLOAD_TOO_LARGE', message: 'Request exceeds the maximum message size', retryable: false },
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          requestId,
          success: false,
          data: null,
          error: { code: 'E_TIMEOUT', message: `timeout calling ${method}`, retryable: true },
        });
      }, timeoutMs);
      this.pending.set(requestId, { resolve, timer, requestId });
      try {
        this.writeFrame(frame);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          requestId,
          success: false,
          data: null,
          error: { code: 'E_CORE_DOWN', message: err instanceof Error ? err.message : String(err), retryable: true },
        });
      }
    });
  }

  async stop() {
    this.stopping = true;
    if (!this.child) {
      this.setState('stopped');
      return;
    }
    try {
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      const child = this.child;
      if (!child) return resolve();
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.setState('stopped');
  }
}

module.exports = { CoreSupervisor, MAX_MESSAGE_BYTES, MAX_PENDING };
