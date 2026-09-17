import { useSyncExternalStore } from 'react'
import PropTypes from 'prop-types'

// The offer to install Taskr — story #483, the line itself.
//
// One line above whatever surface is on screen, never a modal and never over
// a control (AC 1): the browser owns the install sheet, so this says the
// option exists and offers the two answers. Everything that DECIDES whether it
// shows — the captured event, the standalone gate, the 30-day dismissal —
// lives in `src/lib/installOffer.js`; this renders the decision.

const noSubscription = () => () => {}
const never = () => false

/**
 * Whether the offer is showing, read from the controller `src/main.jsx`
 * started. Null — the tests' default, and a build with no controller — reads
 * as never offered. `useSyncExternalStore` rather than a state-and-effect
 * pair, because the controller outlives this component: App remounts on every
 * session end (#440) and the subscription simply follows it.
 */
export function useInstallOffer(offer) {
  return useSyncExternalStore(offer ? offer.subscribe : noSubscription, offer ? offer.isOffered : never)
}

export default function InstallOffer({ onInstall, onDismiss }) {
  return (
    <div className="shell__install" data-testid="install-offer">
      <span className="shell__install-text">Install Taskr on this phone</span>
      {/* One group, so the two answers stay together if a width ever forces
          a wrap — measured at 360px without it: Install beside the sentence,
          Not now alone underneath. */}
      <span className="shell__install-actions">
        <button type="button" className="button" onClick={onInstall}>
          Install
        </button>
        <button type="button" className="button button--quiet" onClick={onDismiss}>
          Not now
        </button>
      </span>
    </div>
  )
}

InstallOffer.propTypes = {
  onInstall: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
}
