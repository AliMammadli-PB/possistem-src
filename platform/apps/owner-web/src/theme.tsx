import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

type Theme = 'dark' | 'light';
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'possistem-portal-theme';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem('milioner-portal-theme');
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function chromeColor(theme: Theme) {
  const market = document.documentElement.dataset.portal === 'market';
  if (market) return theme === 'dark' ? '#07090d' : '#0a4f9c';
  return theme === 'dark' ? '#020617' : '#f8fafc';
}

function syncChrome(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chromeColor(theme));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    syncChrome(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme still applies when storage is unavailable.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      flushSync(() => {
        syncChrome(next);
        setTheme(next);
      });
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const doc = document as ViewTransitionDocument;
    if (!reduceMotion && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(apply);
      return;
    }

    const root = document.documentElement;
    root.classList.add('theme-switching');
    apply();
    window.setTimeout(() => root.classList.remove('theme-switching'), 360);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
