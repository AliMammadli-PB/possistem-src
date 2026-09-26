#!/usr/bin/env node
/** Verify that every local Electron require resolves both in source and app.asar. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import * as asar from '@electron/asar';
import {APP_DIR} from './pos-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET = APP_DIR;
const ELECTRON = path.join(MARKET, 'electron');
const packagePath = path.join(MARKET, 'release', 'win-unpacked', 'resources', 'app.asar');

function sources(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : /\.(?:cjs|js)$/.test(entry.name) ? [full] : [];
  });
}

export function verifyMarketModules({archive = false} = {}) {
  const expected = new Set();
  for (const file of sources(ELECTRON)) {
    expected.add(path.relative(MARKET, file).replaceAll(path.sep, '/'));
    const requireFromFile = createRequire(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/\brequire\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
      const specifier = match[2];
      let resolved;
      try {
        resolved = requireFromFile.resolve(specifier);
      } catch (error) {
        throw new Error(`${path.relative(MARKET,file)}: ${specifier} does not resolve (${error.message})`);
      }
      if (!resolved.startsWith(MARKET + path.sep)) throw new Error(`Local require escaped MarketPOS: ${specifier}`);
      expected.add(path.relative(MARKET, resolved).replaceAll(path.sep, '/'));
    }
  }
  if (archive) {
    if (!fs.existsSync(packagePath)) throw new Error(`Missing packaged app: ${packagePath}`);
    const members = new Set(asar.listPackage(packagePath).map(name=>name.replace(/^\//,'')));
    for (const file of expected) if (!members.has(file)) throw new Error(`Missing from app.asar: ${file}`);
    // Bare requires too: every package in a shipped module's dependency closure
    // must be in the archive. electron-updater once shipped without its own
    // dependencies (node_modules is a symlink the builder cannot walk), and the
    // till could never update itself.
    for (const name of ['electron-updater']) {
      const seen = new Set();
      const walk = (pkgName, fromDir) => {
        const manifest = createRequire(path.join(fromDir, 'noop.js')).resolve(`${pkgName}/package.json`);
        const dir = path.dirname(manifest);
        if (seen.has(dir)) return;
        seen.add(dir);
        const rel = path.relative(fs.realpathSync(path.join(MARKET, 'node_modules')), fs.realpathSync(dir)).replaceAll(path.sep, '/');
        if (!members.has(`node_modules/${rel}/package.json`)) throw new Error(`Missing from app.asar: node_modules/${rel} (needed by ${name})`);
        const deps = JSON.parse(fs.readFileSync(manifest, 'utf8')).dependencies ?? {};
        for (const dep of Object.keys(deps)) walk(dep, dir);
      };
      walk(name, MARKET);
    }
    const packedMain = asar.extractFile(packagePath, 'electron/main.cjs');
    const sourceMain = fs.readFileSync(path.join(ELECTRON,'main.cjs'));
    if (!packedMain.equals(sourceMain)) throw new Error('Packaged electron/main.cjs differs from verified source');
  }
  return {moduleCount:expected.size,archive:archive?packagePath:null};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result = verifyMarketModules({archive:process.argv.includes('--archive')});
  console.log(`PASS ${result.moduleCount} MarketPOS Electron files and local requires${result.archive?' in app.asar':''}`);
}
