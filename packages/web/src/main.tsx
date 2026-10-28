import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import './site/site.css';
import { Site } from './site/App';
createRoot(document.getElementById('root')!).render(<StrictMode><Site /></StrictMode>);
