import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const inLab = /^\/lab\/?$/.test(window.location.pathname);
const inInstrument = /^\/instrument\/?$/.test(window.location.pathname);
const Portfolio = lazy(() => import('./Portfolio.jsx'));
const Galaxy = lazy(() => import('./App.jsx'));
const Instrument = lazy(() => import('./instrument/GestureInstrument.jsx'));
const Page = inInstrument ? Instrument : inLab ? Galaxy : Portfolio;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center" style={{ background: inLab || inInstrument ? '#111716' : '#f6f7f3', color: inLab || inInstrument ? '#ffffff' : '#242b26' }} role="status">{inInstrument ? 'Loading Airform...' : 'Loading portfolio...'}</div>}>
      <Page />
    </Suspense>
  </React.StrictMode>
);
