import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { boot } from './runtime.js';
import './style.css';

// The document may come from the network (?config=, /config/mars.json), so the
// device is assembled before the first render.
boot().then((runtime) => createRoot(document.getElementById('root')).render(<App {...runtime} />));
