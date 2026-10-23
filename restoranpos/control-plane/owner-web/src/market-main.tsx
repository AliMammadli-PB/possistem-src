import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/oswald';
import '@fontsource-variable/source-sans-3';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme';
import { ToastProvider } from './ui/overlays';
import './styles.css';

import './workspace.css';

document.documentElement.dataset.portal = 'market';

// Same shell as the restaurant portal; only the mount path differs. BASE_URL is
// "/marketpos/" for this build, and BrowserRouter wants it without the trailing
// slash.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      basename={basename}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
