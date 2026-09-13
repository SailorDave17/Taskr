import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { startAppUpdates } from './lib/appUpdate.js'
import './index.css'

// #347 — the one registration path, and it starts BEFORE the app loads.
//
// Measured on #347 with a deploy whose bundle threw on load: the page
// registered nothing and sent nothing, so the next, GOOD deploy's worker sat
// waiting — two reloads stayed on the broken build, and only closing every
// Taskr window recovered it. Under `prompt` only this page's own code takes a
// waiting worker, so that code must not be downstream of anything that can
// fail. The updater starts first, from its own small module graph, and the app
// is imported separately: a module inside App that throws can no longer take
// the updater down with it, and the next good deploy is taken as usual.
// (A render-time crash was never the risk — `render()` returns before React
// renders anything, so the updater would have started regardless.)
//
// Outside React on purpose: it lives for the life of the page, and App
// remounts on every session end (#440).
const updates = startAppUpdates({ registerSW })

// An app that fails to load leaves a blank page: nothing on it to protect, and
// nobody coming back to it on purpose. So the updater looks for the fixed
// deploy — or a rollback — every minute instead of every hour (owner decision,
// 2026-09-13). The error is still reported.
import('./App.jsx')
  .then(({ default: App }) => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((error) => {
    updates.appFailed()
    console.error(error)
  })
