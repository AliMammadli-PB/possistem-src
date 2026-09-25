import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const bundle = readFileSync(path.resolve(__dirname, '../../index-DAmHwBc4.js'), 'utf8');

describe('restaurant till Parametrlər IA', () => {
  it('splits device settings from the admin hub', () => {
    expect(bundle).toContain('function SettingsAccordion');
    expect(bundle).toContain('defaultOpen: id === "restaurant"');
    expect(bundle).toContain('function AdminHubPage');
    expect(bundle).toContain('function isFloorPath');
    expect(bundle).toContain('path: "/admin"');
    expect(bundle).toContain('sectionRestaurant');
    expect(bundle).toContain('deviceHint');
    expect(bundle).not.toMatch(/adminLinks\.length > 0 &&/);
  });

  it('fixes the listed copy and safety bugs', () => {
    expect(bundle).toContain('Email və ya parol səhvdir');
    expect(bundle).toContain('Zalı redaktə et');
    expect(bundle).toContain('function formatTillDate');
    expect(bundle).toContain('showLicenseDetails');
    expect(bundle).toContain('runOperationalReset');
    expect(bundle).toContain('editorOpen');
    expect(bundle).toContain('ps-catalog-page');
    expect(bundle).toContain('productQuery');
    expect(bundle).toContain('Digər dillər / Ətraflı');
  });

  it('does not advertise the seed PIN on staff login cards', () => {
    expect(bundle).not.toMatch(/children: user\.code \}\)/);
  });
});
