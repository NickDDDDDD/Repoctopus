import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './tokens.css';
import './styles.css';

const root = document.querySelector('#root');
if (!(root instanceof HTMLElement)) throw new Error('Desktop root element is missing');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
