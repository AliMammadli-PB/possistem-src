'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { reportUiState } from '@/lib/ui-diagnostics';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'possistem-theme';

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function syncThemeChrome(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0c1628' : '#ffffff');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const initial=document.documentElement.dataset.theme==='light'?'light':'dark';
    setTheme(initial);reportUiState('theme',{theme:initial});
  }, []);

  const toggleTheme = useCallback(() => {
    const current=document.documentElement.dataset.theme==='light'?'light':'dark';
    const next:Theme=current==='dark'?'light':'dark';
    syncThemeChrome(next);setTheme(next);
    try{window.localStorage.setItem(STORAGE_KEY,next);}catch{/* visual state still works */}
    reportUiState('theme',{theme:next});
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
