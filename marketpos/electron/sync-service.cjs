const dgram = require('node:dgram');
const http = require('node:http');
const { createPrivateKey, createPublicKey, randomBytes, sign, verify } = require('node:crypto');
const lanCrypto = require('./lan-crypto.cjs');
const { verifySignedCommand } = require('./command-auth.cjs');

const MULTICAST_ADDRESS = '239.255.43.17';
const DISCOVERY_PORT = 43170;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function publicKeyFromHex(hex) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

class MarketSyncService {
  constructor(opts) {
    this.core = opts.core;
    this.getState = opts.getState;
    this.controlApi = opts.controlApi;
    this.appVersion = opts.appVersion;
    this.onStatus = opts.onStatus;
    this.onReport = opts.onReport;
    this.rewriteEvents = opts.rewriteEvents;
    this.hydrateImages = opts.hydrateImages;
    this.peers = new Map();
    this.seenCommands = new Set();
    this.serverVector = {};
    this.timer = null;
    this.udp = null;
    this.httpServer = null;
    this.httpPort = 0;
    this.retryTimer = null;
    this.running = false;
    this.status = { mode: 'offline', pending: 0, peerCount: 0, vpsConnected: false };
  }

  outgoingEvents(events) {
    return typeof this.rewriteEvents === 'function' ? this.rewriteEvents(events || []) : events || [];
  }

  queueHydrate() {
    if (typeof this.hydrateImages !== 'function' || this.hydrateBusy) return;
    this.hydrateBusy = true;
    void this.hydrateImages()
      .catch(() => undefined)
      .finally(() => {
        this.hydrateBusy = false;
      });
  }

  async call(method, payload = {}) {
    const result = await this.core.invoke(method, payload, 20000);
    if (!result?.success) throw new Error(result?.error?.message || `${method} failed`);
    return result.data;
  }

  signDocument(document, state) {
    const privateKey = createPrivateKey({ key: Buffer.from(state.deviceProof.privateKeyPkcs8, 'base64'), type: 'pkcs8', format: 'der' });
    return sign(null, Buffer.from(stableStringify(document), 'utf8'), privateKey).toString('hex');
  }

  verifyDocument(document, signature, publicKeyHex) {
    try { return verify(null, Buffer.from(stableStringify(document), 'utf8'), publicKeyFromHex(publicKeyHex), Buffer.from(signature, 'hex')); }
    catch { return false; }
  }

  verifyLicenseProof(proof, state, deviceId, publicKeyHex) {
    try {
      const envelope = proof?.signedLicense;
      const key = proof?.signingKey;
      if (!envelope?.payload || !envelope?.signature || key?.publicKeyHex !== state.pinnedLicenseKey?.publicKeyHex) return false;
      const valid = verify(null, Buffer.from(JSON.stringify(envelope.payload), 'utf8'), publicKeyFromHex(key.publicKeyHex), Buffer.from(envelope.signature, 'hex'));
      if (!valid) return false;
      // A proof signed while the licence was active otherwise keeps authenticating
      // this peer forever, long after the licence lapsed.
      const expiry = envelope.payload.expiresAt ?? envelope.payload.validUntil;
      if (expiry != null) {
        const expiresAtMs = typeof expiry === 'number' ? expiry : Date.parse(expiry);
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return false;
      }
      return envelope.payload.status === 'active' && envelope.payload.customerId === state.activation.customerId &&
        envelope.payload.deviceId === deviceId && envelope.payload.devicePublicKey === publicKeyHex;
    } catch { return false; }
  }

  activatedState() {
    const state = this.getState();
    return state.activation?.mode === 'active' && state.activation?.serverDeviceId && state.activation?.customerId ? state : null;
  }

  async start() {
    if (this.running) return;
    const state = this.activatedState();
    if (!state) {
      // A till is often activated minutes after launch. Without a retry, start()
      // is never reached again for the life of the process, so the till never
      // discovers its peers and never reports status.
      if (!this.retryTimer) {
        this.retryTimer = setInterval(() => void this.start().catch(() => undefined), 30000);
        this.retryTimer.unref();
      }
      return;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.running = true;
    await this.call('sync.configure', { deviceId: state.activation.serverDeviceId });
    // Restore the cloud cursor from the core; holding it only in memory meant every
    // app start re-uploaded the entire outbox.
    this.serverVector = await this.call('sync.getServerVector')
      .then((r) => r?.vector || {})
      .catch(() => ({}));
    await this.startHttp();
    await this.startDiscovery();
    await this.cycle().catch(() => undefined);
    this.timer = setInterval(() => void this.cycle().catch((error) => console.error('[market-sync]', error.message || error)), 2000);
    this.timer.unref();
  }

  async stop() {
    this.running = false;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.udp) this.udp.close();
    this.udp = null;
    if (this.httpServer) await new Promise((resolve) => this.httpServer.close(resolve));
    this.httpServer = null;
  }

  async startHttp() {
    this.httpServer = http.createServer((req, res) => void this.handleHttp(req, res));
    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(0, '0.0.0.0', resolve);
    });
    this.httpPort = this.httpServer.address().port;
  }

  startDiscovery() {
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('message', (bytes, info) => {
      try {
        const packet = JSON.parse(bytes.toString('utf8'));
        const { signature, ...document } = packet;
        const state = this.activatedState();
        if (!state || document.v !== 1 || document.customerId !== state.activation.customerId || document.deviceId === state.activation.serverDeviceId) return;
        if (Math.abs(Date.now() - Number(document.ts)) > 15000 || !this.verifyDocument(document, signature, document.publicKey) ||
            !this.verifyLicenseProof(document.licenseProof, state, document.deviceId, document.publicKey)) return;
        const known = this.peers.get(document.deviceId);
        // The encryption key is part of the signed beacon, so it cannot be
        // swapped or stripped without breaking the signature.
        const encKey = typeof document.encKey === 'string' && /^[0-9a-f]{64}$/i.test(document.encKey) ? document.encKey : null;
        // Beacons are signed but replayable inside the 15s window. Requiring a
        // strictly newer timestamp stops a captured beacon from being replayed
        // from another host to redirect this peer's next event batch.
        if (known && Number(document.ts) <= (known.ts || 0)) return;
        this.peers.set(document.deviceId, {
          host: info.address,
          port: document.port,
          publicKey: document.publicKey,
          encKey,
          // Keep the cursor we already have for this peer; rebuilding it on every
          // beacon re-sends the whole backlog every cycle.
          vector: known?.vector || {},
          ts: Number(document.ts),
          seenAt: Date.now(),
        });
      } catch { /* invalid discovery packet */ }
    });
    return new Promise((resolve) => this.udp.bind(DISCOVERY_PORT, () => {
      try { this.udp.addMembership(MULTICAST_ADDRESS); this.udp.setMulticastTTL(1); this.udp.setMulticastLoopback(true); } catch { /* no multicast adapter */ }
      resolve();
    }));
  }

  announce(state) {
    if (!this.udp || !this.httpPort) return;
    if (!state.activation.licenseProof) return;
    const document = { v: 1, customerId: state.activation.customerId, deviceId: state.activation.serverDeviceId, port: this.httpPort, ts: Date.now(), publicKey: state.deviceProof.publicKeyHex, licenseProof: state.activation.licenseProof };
    if (state.deviceProof.encPublicKeyHex) document.encKey = state.deviceProof.encPublicKeyHex;
    const packet = Buffer.from(JSON.stringify({ ...document, signature: this.signDocument(document, state) }));
    this.udp.send(packet, DISCOVERY_PORT, MULTICAST_ADDRESS, () => undefined);
  }

  async readJson(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('request too large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  /**
   * Verifies a signed peer document, applies its events and returns this till's
   * signed answer. Returns null when the peer's proof fails.
   */
  async exchangeDocument(body, state) {
    const { signature, publicKey, ...document } = body || {};
    if (!state || document.customerId !== state.activation.customerId || Math.abs(Date.now() - Number(document.signedAt)) > 300000 || !this.verifyDocument(document, signature, publicKey) ||
        !this.verifyLicenseProof(document.licenseProof, state, document.deviceId, publicKey)) return null;
    await this.call('sync.apply', { events: document.events || [] });
    this.queueHydrate();
    const outgoing = await this.call('sync.export', { vector: document.vector || {} });
    const responseDoc = { customerId: state.activation.customerId, deviceId: state.activation.serverDeviceId, signedAt: Date.now(), vector: outgoing.vector, events: this.outgoingEvents(outgoing.events), licenseProof: state.activation.licenseProof };
    return { ...responseDoc, publicKey: state.deviceProof.publicKeyHex, signature: this.signDocument(responseDoc, state) };
  }

  async handleHttp(req, res) {
    try {
      const sealed = req.url === '/v2/exchange';
      // /v1 is the plaintext exchange of tills that predate LAN encryption; it
      // goes away once every till in the field announces an encryption key.
      if (req.method !== 'POST' || (!sealed && req.url !== '/v1/exchange')) { res.writeHead(404).end(); return; }
      const state = this.activatedState();
      const raw = await this.readJson(req);
      let body = raw;
      let responseKey = null;
      if (sealed) {
        if (!state?.deviceProof?.encPrivateKeyPkcs8) { res.writeHead(404).end(); return; }
        ({ value: body, responseKey } = lanCrypto.openRequest(raw, state.deviceProof.encPrivateKeyPkcs8, state.deviceProof.encPublicKeyHex));
      }
      const answer = await this.exchangeDocument(body, state);
      if (!answer) { res.writeHead(401).end(JSON.stringify({ error: 'peer proof failed' })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(sealed ? lanCrypto.sealResponse(answer, responseKey) : answer));
    } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message || String(error) })); }
  }

  async exchangePeer(peer, state) {
    const local = await this.call('sync.export', { vector: peer.vector || {} });
    const document = { customerId: state.activation.customerId, deviceId: state.activation.serverDeviceId, signedAt: Date.now(), vector: local.vector, events: this.outgoingEvents(local.events), licenseProof: state.activation.licenseProof };
    const signed = { ...document, publicKey: state.deviceProof.publicKeyHex, signature: this.signDocument(document, state) };
    // Sealed whenever the peer announced an encryption key; plaintext /v1 only
    // for a peer too old to have one.
    const sealed = peer.encKey ? lanCrypto.sealRequest(signed, peer.encKey) : null;
    const response = await fetch(`http://${peer.host}:${peer.port}/${sealed ? 'v2' : 'v1'}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sealed ? sealed.envelope : signed), signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`LAN ${response.status}`);
    const body = sealed ? lanCrypto.openResponse(await response.json(), sealed.responseKey) : await response.json();
    const { signature, publicKey, ...responseDoc } = body;
    if (responseDoc.customerId !== state.activation.customerId || !this.verifyDocument(responseDoc, signature, publicKey) ||
        !this.verifyLicenseProof(responseDoc.licenseProof, state, responseDoc.deviceId, publicKey)) throw new Error('LAN response proof failed');
    peer.seenAt = Date.now();
    // Apply before advancing the cursor — recording the peer as up to date first
    // means a failed apply loses those events from every later export.
    await this.call('sync.apply', { events: responseDoc.events || [] });
    this.queueHydrate();
    peer.vector = responseDoc.vector || {};
    await this.call('sync.setPeerVector', { peerDeviceId: responseDoc.deviceId, vector: peer.vector })
      .catch(() => undefined);
  }

  async exchangeVps(state, local) {
    const signedAt = new Date().toISOString();
    const nonce = randomBytes(16).toString('hex');
    const document = { deviceId: state.activation.serverDeviceId, appVersion: this.appVersion(), signedAt, nonce, vector: local.vector, events: this.outgoingEvents(local.events) };
    const body = { ...document, deviceFingerprint: state.activation.deviceId, deviceSignature: this.signDocument(document, state) };
    const response = await fetch(this.controlApi('/market-pos/sync/exchange'), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`VPS ${response.status}`);
    const payload = await response.json();
    await this.call('sync.apply', { events: payload.events || [] });
    this.queueHydrate();
    const accepted = payload.acceptedEventIds || [];
    await this.call('sync.ack', { eventIds: accepted });
    // Only advance the cursor for what the server actually acked. Taking the
    // server's vector wholesale filters unacked events out of every future export
    // while they stay pending forever.
    if (payload.serverVector && accepted.length === (local.events || []).length) {
      this.serverVector = payload.serverVector;
      await this.call('sync.setServerVector', { vector: this.serverVector }).catch(() => undefined);
    }
    await this.dispatchCommands(state, payload.commands || []);
    return payload;
  }

  async reportCommand(state, commandId, status, result, error) {
    await fetch(this.controlApi(`/market-pos/commands/${commandId}/result`), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: state.activation.serverDeviceId,
        deviceFingerprint: state.activation.deviceId,
        status,
        result: result || undefined,
        error: error || undefined,
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
  }

  async dispatchCommands(state, commands) {
    if (!Array.isArray(commands) || commands.length === 0) return;
    let snapshot = null;
    try { snapshot = await this.call('state.get'); } catch { snapshot = null; }
    const registerId = snapshot?.settings?.deviceRegisterId || snapshot?.settings?.defaultRegisterId;
    for (const received of commands) {
      // Only the control plane's signed copy runs - see command-auth.cjs.
      const verified = verifySignedCommand(received, {
        publicKeyHex: state.pinnedLicenseKey?.publicKeyHex,
        deviceId: state.activation.serverDeviceId,
        customerId: state.activation.customerId,
        seen: this.seenCommands,
      });
      if (!verified.ok) {
        console.warn('[market-sync] command refused', received?.id, verified.reason);
        if (received?.id) await this.reportCommand(state, received.id, 'failed', null, `Əmr imzası etibarsızdır (${verified.reason})`).catch(() => undefined);
        continue;
      }
      const command = verified.command;
      try {
        if (!registerId) throw new Error('Kassa tapılmadı');
        let report;
        if (command.kind === 'x_report') {
          report = await this.call('cash.xReport', { registerId });
        } else if (command.kind === 'z_report') {
          const x = await this.call('cash.xReport', { registerId });
          const actual = Number(command.payload?.actualCashMinor ?? x.expectedCashMinor ?? 0);
          report = await this.call('cash.zClose', {
            registerId,
            actorId: 'system',
            actualCashMinor: actual,
            treasuryMinor: 0,
          });
        } else {
          throw new Error(`Naməlum əmr: ${command.kind}`);
        }
        // The report itself already ran (a z_report has closed the shift), so a
        // printing failure must not be reported as a failed command — that would
        // invite the owner to re-issue a close that already happened. Report the
        // success and carry the print error alongside it.
        let printError = null;
        if (typeof this.onReport === 'function') {
          try {
            await this.onReport(report);
          } catch (error) {
            printError = error.message || String(error);
          }
        }
        await this.reportCommand(state, command.id, 'done', report, printError);
      } catch (error) {
        await this.reportCommand(state, command.id, 'failed', null, error.message || String(error));
      }
    }
  }

  publish(next) {
    this.status = next;
    this.onStatus?.(next);
  }

  async cycle() {
    if (!this.running) return;
    // The 2s timer is shorter than the 8s VPS timeout, so without this guard
    // several cycles overlap and re-send the same events to the same peers
    // exactly when the network is already slow.
    if (this.cycleBusy) return;
    this.cycleBusy = true;
    try {
      await this.runCycle();
    } finally {
      this.cycleBusy = false;
    }
  }

  async runCycle() {
    const state = this.activatedState();
    if (!state || this.core.state !== 'ready') return;
    this.announce(state);
    for (const [id, peer] of this.peers) if (Date.now() - peer.seenAt > 15000) this.peers.delete(id);
    let lanConnected = false;
    await Promise.all([...this.peers.values()].map(async (peer) => {
      try { await this.exchangePeer(peer, state); lanConnected = true; } catch { /* peer may have left */ }
    }));
    const local = await this.call('sync.export', { vector: this.serverVector });
    let vpsConnected = false; let server = null;
    try { server = await this.exchangeVps(state, local); vpsConnected = true; } catch { /* remain LAN/offline */ }
    // Hourly retention pass; the outbox is otherwise append-only for the life of
    // the install, which eventually starves the export window.
    if (Date.now() - (this.lastPruneAt || 0) > 3600000) {
      this.lastPruneAt = Date.now();
      await this.call('sync.prune', { keepDays: 30 }).catch(() => undefined);
    }
    const current = await this.call('sync.status');
    this.queueHydrate();
    this.publish({ mode: vpsConnected ? 'vps' : lanConnected ? 'lan' : 'offline', pending: current.pending, peerCount: this.peers.size, vpsConnected, bootstrapRequired: Boolean(server?.bootstrapRequired), catalogRevision: server?.catalogRevision || 0 });
  }

  async bootstrap() {
    const result = await this.call('sync.bootstrap');
    await this.cycle();
    return result;
  }
}

module.exports = { MarketSyncService, stableStringify };
