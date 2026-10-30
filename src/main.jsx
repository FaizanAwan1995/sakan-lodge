import {ledgerBasename} from './ledger-routing.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';
import './ui-system.css';
import { startMonitoring } from './monitoring.js';

startMonitoring();

const routerBase = import.meta.env.VITE_ROUTER_BASENAME || ledgerBasename(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={routerBase}>
    <App />
  </BrowserRouter>
);
