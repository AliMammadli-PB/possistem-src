import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/montserrat';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme';
import { ToastProvider } from './ui/overlays';
import './styles.css';

import './workspace.css';
import './portal-ui.css';
import './billing.css';
import './commerce.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      basename="/pos/app"
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
