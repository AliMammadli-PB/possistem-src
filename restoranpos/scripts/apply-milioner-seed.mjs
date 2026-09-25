import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = path.join(ROOT, 'database', 'seed', '001_reference_data.sql');
const fragPath = path.join(ROOT, 'scripts', '_milioner_menu_fragment.sql');

const seed = fs.readFileSync(seedPath, 'utf8');
const frag = fs.readFileSync(fragPath, 'utf8');

// Keep everything before categories (roles, floor plan, settings).
const marker = '-- ------------------------------------------------------------- categories --';
const headPart = seed.includes(marker) ? seed.split(marker)[0] : seed;

let settings = headPart
  .replaceAll('Maison Aurelia', 'Milioner')
  .replace(
    /INSERT( OR IGNORE)? INTO app_settings \(key, value, value_type, updated_at\) VALUES/,
    'INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at) VALUES',
  )
  .replace(
    /\('restaurant\.tagline',\s*'[^']*',\s*'string',\s*0\),/,
    "('restaurant.tagline',     'Restoran & Lounge',                   'string', 0),",
  )
  .replace(
    /\('restaurant\.address',\s*'[^']*',\s*'string',\s*0\),/,
    "('restaurant.address',     'Lütfizadə 98',                        'string', 0),",
  )
  .replace(
    /\('restaurant\.phone',\s*'[^']*',\s*'string',\s*0\),/,
    "('restaurant.phone',       '+994505013540',                       'string', 0),",
  )
  .replace(
    /\('restaurant\.taxId',\s*'[^']*',\s*'string',\s*0\),/,
    "('restaurant.taxId',       '',                                    'string', 0),\n  ('restaurant.hours',       '12:00 – 02:00',                      'string', 0),",
  )
  .replace(
    /\('locale\.currencyDisplay',\s*'[^']*',\s*'string',\s*0\),/,
    "('locale.currencyDisplay', 'symbol',                            'string', 0),",
  )
  .replace(
    /\('finance\.taxPercent',\s*'[^']*',\s*'int',\s*0\),/,
    "('finance.taxPercent',     '0',                                 'int',    0),",
  )
  .replace(
    /\('finance\.servicePercent',\s*'[^']*',\s*'int',\s*0\),/,
    "('finance.servicePercent', '0',                                 'int',    0),",
  )
  .replace(
    /\('finance\.taxIncluded',\s*'[^']*',\s*'bool',\s*0\),/,
    "('finance.taxIncluded',    '1',                                 'bool',   0),",
  )
  .replace(
    /\('printer\.renderMode',\s*'[^']*',\s*'string',\s*0\),/,
    "('printer.renderMode',     'raster',                            'string', 0),",
  );

// Strip every banner block; we write a single clean header.
settings = settings.replace(/^-- =+[\s\S]*?-- =+\s*/gm, '');
settings = settings.replace(/\n{3,}/g, '\n\n').trim();

if (!settings.includes('perm-users-manage')) {
  settings = settings.replace(
    "('perm-discount-rules',  'discount.manage',   'Manage discount rules');",
    "('perm-discount-rules',  'discount.manage',   'Manage discount rules'),\n  ('perm-users-manage',    'users.manage',      'Create and deactivate local staff');",
  );
  settings = settings.replace(
    "('role-administrator','perm-discount-rules');",
    "('role-administrator','perm-discount-rules'),\n  ('role-administrator','perm-users-manage'),\n  ('role-manager','perm-users-manage');",
  );
}

// Avoid duplicating restaurant.hours if re-run.
settings = settings.replace(
  /\('restaurant\.hours',\s*'[^']*',\s*'string',\s*0\),\s*\('restaurant\.hours',\s*'[^']*',\s*'string',\s*0\),/,
  "('restaurant.hours',       '12:00 – 02:00',                      'string', 0),",
);

const header = `-- ============================================================================
-- Milioner - reference & demo data
--
-- Prices are AZN minor units (qəpik): 900 = 9.00 ₼.
-- Identifiers are readable slugs rather than UUIDs so the seed stays diffable.
-- Demo admin is created by the C++ seeder (PIN hashed with a random salt).
-- ============================================================================

`;

const out = header + settings + '\n\n' + frag.trimEnd() + '\n';
fs.writeFileSync(seedPath, out);
console.log('seed rewritten,', out.split('\n').length, 'lines');
