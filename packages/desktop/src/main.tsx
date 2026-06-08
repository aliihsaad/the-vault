import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { SparkOverlay } from './components/spark/SparkOverlay.js';
import { isSparkOverlayRoute } from './spark/spark-overlay-route.js';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Failed to find the root element');
const root = createRoot(container);

// The persistent overlay window (roadmap D) loads this same bundle at the
// #spark-overlay route; mount the compact overlay instead of the full app.
const isOverlay = isSparkOverlayRoute(window.location.hash);

root.render(
  <React.StrictMode>
    {isOverlay ? <SparkOverlay /> : <App />}
  </React.StrictMode>
);
