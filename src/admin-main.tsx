import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminGate } from './components/AdminGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminGate />
  </StrictMode>,
);
