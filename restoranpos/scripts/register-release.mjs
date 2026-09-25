#!/usr/bin/env node
/**
 * Registers (or updates) the current package.json version as a published
 * release in the control panel, pointing at the public update-feed setup URL.
 *
 *   SEED_SUPERADMIN_PASSWORD='…' node scripts/register-release.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.POS_CONTROL_URL ?? 'https://possistem.az/pos/api').replace(/\/+$/, '');
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@cyberplus.local';
const PASS = process.env.SEED_SUPERADMIN_PASSWORD ?? '';
const FEED = (process.env.UPDATE_FEED_URL ?? 'https://possistem.az/pos-updates').replace(/\/+$/, '');

if (!PASS) {
  console.error('SEED_SUPERADMIN_PASSWORD required');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const setupName = `Possistem-Setup-${version}.exe`;
const localSetup =
  [
    path.join(ROOT, `release-${version}`, setupName),
    path.join(ROOT, 'release', setupName),
  ].find((candidate) => fs.existsSync(candidate)) ?? path.join(ROOT, `release-${version}`, setupName);
const artifactUrl = `${FEED}/${setupName}`;

let checksumSha256 = null;
if (fs.existsSync(localSetup)) {
  checksumSha256 = createHash('sha256').update(fs.readFileSync(localSetup)).digest('hex');
}

async function req(pathname, { method = 'GET', body, cookie, csrf } = {}) {
  const headers = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { ok: res.ok, status: res.status, json, setCookie, headers: res.headers };
}

function mergeCookies(existing, setCookie) {
  const map = new Map();
  for (const part of (existing || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const raw of setCookie) {
    const first = raw.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) map.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const login = await req('/auth/login', {
  method: 'POST',
  body: { email: EMAIL, password: PASS },
});
if (!login.ok) {
  console.error('login failed', login.status, login.json);
  process.exit(1);
}

let cookie = mergeCookies('', login.setCookie);
const csrf = login.json?.csrfToken ?? login.json?.csrf ?? '';
if (login.json?.mustChangePassword) {
  console.warn('[register-release] warning: mustChangePassword is true — continuing');
}

const list = await req('/releases', { cookie, csrf });
if (!list.ok) {
  console.error('list releases failed', list.status, list.json);
  process.exit(1);
}

const existing = (list.json ?? []).find((r) => r.version === version && r.channel === 'stable');
const payload = {
  channel: 'stable',
  version,
  artifactUrl,
  checksumSha256,
  published: true,
  notes: `Milioner POS ${version} Windows setup`,
};

let result;
if (existing) {
  result = await req(`/releases/${existing.id}`, {
    method: 'PATCH',
    body: payload,
    cookie,
    csrf,
  });
} else {
  result = await req('/releases', { method: 'POST', body: payload, cookie, csrf });
}

if (!result.ok) {
  console.error('register failed', result.status, result.json);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      action: existing ? 'updated' : 'created',
      version,
      artifactUrl,
      checksumSha256,
      id: result.json?.id,
    },
    null,
    2,
  ),
);
