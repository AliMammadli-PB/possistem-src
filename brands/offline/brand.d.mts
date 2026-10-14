// Types for the vite configs that import the Offline brand plugin.
import type { Plugin } from 'vite';

export function offlineBrand(options: { appRoot: string }): Plugin;
