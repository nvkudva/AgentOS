import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'auto';

/** Theme lives on <html data-theme>, so CSS decides everything and React re-renders nothing. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('atrium.theme') as Theme) ?? 'light');

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const real = theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = real;
      document.documentElement.dataset.themeMode = theme;
    };
    apply();
    localStorage.setItem('atrium.theme', theme);
    if (theme === 'auto') { mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply); }
  }, [theme]);

  const resolved: 'light' | 'dark' =
    theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;

  return { theme, setTheme, resolved };
}
