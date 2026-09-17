import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { startAppUpdates } from './lib/appUpdate.js'
import { startInstallOffer } from './lib/installOffer.js'
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

// #483 — the browser's install offer is captured here for the same reason:
// `beforeinstallprompt` fires whenever Chrome decides the criteria are met,
// which can be before App's import below has resolved, and an event that fired
// before a listener existed is gone. The controller lives for the life of the
// page; App reads it through a prop.
const installOffer = startInstallOffer()

// An app that fails to load leaves a blank page: nothing on it to protect, and
// nobody coming back to it on purpose. So the updater looks for the fixed
// deploy — or a rollback — every minute instead of every hour (owner decision,
// 2026-09-13). The error is still reported.
import('./App.jsx')
  .then(({ default: App }) => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App installOffer={installOffer} />
      </StrictMode>,
    )
  })
  .catch((error) => {
    updates.appFailed()
    console.error(error)
  })
