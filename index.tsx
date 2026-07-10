import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { trackNotificationOpenFromUrl } from '@/utils/notificationSource';
import { initErrorTracking, captureException } from '@/services/errorTracking';

// Fire-and-forget — must not block first paint. No-ops without a DSN.
initErrorTracking();

// Catch errors React's own boundary can't reach: async code, event handlers,
// and rejected promises that aren't otherwise handled.
window.addEventListener('error', (event) => {
  captureException(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  captureException(event.reason);
});

// If the service worker tagged this navigation with a notification type
// (`?nsrc=…`), record the open and strip the param before the router mounts.
trackNotificationOpenFromUrl();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
