import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TestPracticeMode } from './test/TestPracticeMode.tsx'

// Check for test mode via query param or env var
const urlParams = new URLSearchParams(window.location.search);
const isTestMode = urlParams.get('test') === 'practice' || import.meta.env.VITE_TEST_MODE === 'practice';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTestMode ? <TestPracticeMode /> : <App />}
  </StrictMode>,
)
