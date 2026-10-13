import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

const routerBase = import.meta.env.VITE_ROUTER_BASENAME || (window.location.pathname.startsWith('/ledger/') ? '/ledger/' : '/');

createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={routerBase}>
    <App />
  </BrowserRouter>
);
