/**
 * Which retail till the market:* scripts build. Geyim POS is a fork of Market
 * POS with the same layout, so the scripts are shared: POS_APP=geyimpos.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS = {
  marketpos: { core: 'market-pos-core', artifact: 'MarketPos', icon: 'marketpos-app-icon-v2.png' },
  geyimpos: { core: 'geyim-pos-core', artifact: 'GeyimPos', icon: 'geyimpos-app-icon.png' },
  aptekpos: { core: 'aptek-pos-core', artifact: 'AptekPos', icon: 'aptekpos-app-icon.png' },
};

export const POS_APP = process.env.POS_APP || 'marketpos';
if (!APPS[POS_APP]) throw new Error(`POS_APP must be one of ${Object.keys(APPS).join(', ')}`);
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', POS_APP);
export const { core: CORE_NAME, artifact: ARTIFACT_NAME, icon: ICON_FILE } = APPS[POS_APP];
