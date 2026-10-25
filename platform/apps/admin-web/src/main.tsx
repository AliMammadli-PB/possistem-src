import { installLiveRefresh } from './lib/live';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource-variable/montserrat';

import App from './App';
import './styles.css';
import './theme-refresh.css';
import './console-canvas.css';
import './mobile-admin.css';
import './receipt.css';
import './commerce-admin.css';
import './support-service.css';

function resolveRouterBase() {
  const buildBase = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  const firstSegment = window.location.pathname.match(/^\/([^/]+)/)?.[1];
  if (firstSegment && /^m-[a-z0-9]+$/i.test(firstSegment)) {
    return `/${firstSegment}`;
  }
  return buildBase;
}

const routerBase = resolveRouterBase();
installLiveRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBase}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
