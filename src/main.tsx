import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/google-theme.css';
import App from './App.tsx';

try {
  const raw = window.localStorage.getItem('municipality_game_config');
  let savedTheme: 'classic' | 'google' = 'classic';
  if (raw) {
    const parsed = JSON.parse(raw) as { uiTheme?: unknown; quality?: unknown } | null;
    if (parsed && typeof parsed === 'object') {
      if (parsed.uiTheme === 'google' || parsed.uiTheme === 'classic') {
        savedTheme = parsed.uiTheme;
      }
      if (
        parsed.quality === 'high' ||
        parsed.quality === 'medium' ||
        parsed.quality === 'low'
      ) {
        document.documentElement.dataset.quality = parsed.quality;
      }
    }
  }
  document.documentElement.dataset.theme = savedTheme;
} catch {
  document.documentElement.dataset.theme = 'classic';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
