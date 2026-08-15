import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import '../styles/ThemeToggle.css';

const STORAGE_KEY = 'family-hierarchy-theme';

// `defaultTheme` (admin-configured, see AdminPanel/useAppSettings) only ever
// applies to someone who's never made their own choice — once a person has
// toggled it, their own pick in localStorage always wins over the admin default.
export default function ThemeToggle({ defaultTheme }) {
  const hadStoredPref = useRef(!!localStorage.getItem(STORAGE_KEY));
  // Dark is the fallback for anyone with no stored preference and no admin
  // default yet (first visit, or localStorage cleared) — doesn't affect anyone
  // who's already chosen either theme, since that choice is what's actually read here.
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY) || defaultTheme || 'dark');

  useEffect(() => {
    if (!hadStoredPref.current && defaultTheme) setTheme(defaultTheme);
  }, [defaultTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        hadStoredPref.current = true;
        setTheme((t) => (t === 'light' ? 'dark' : 'light'));
      }}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          className="theme-toggle-icon"
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
