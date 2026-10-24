import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/montserrat';
import { AuthProvider } from './auth/AuthContext';
import ChatStandaloneApp from './ChatStandaloneApp';
import { ThemeProvider } from './theme';
import { ToastProvider } from './ui/overlays';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      basename="/chat"
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <ChatStandaloneApp />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
