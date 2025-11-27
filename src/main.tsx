import React from 'react';
import ReactDOM from 'react-dom/client';
import { DriveThruScreen } from './OrderDisplay.js';
import './index.css';

const isTestMode = window.location.pathname === '/test';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <DriveThruScreen testMode={isTestMode} />
    </React.StrictMode>
);
