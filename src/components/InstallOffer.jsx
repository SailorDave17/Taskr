import { useSyncExternalStore } from 'react'
import PropTypes from 'prop-types'

// The offer to install Taskr — stories #483 and #484, the line itself.
//
// One line above whatever surface is on screen, never a modal and never over
// a control (#483 AC 1): the browser owns the install sheet, so this says the
// option exists and offers the two answers. Everything that DECIDES whether it
// shows — the captured event, the standalone gate, the 30-day dismissal, and
// #484's is-this-Safari-on-iOS question — lives in `src/lib/installOffer.js`;
// this renders the decision.
//
// TWO VARIANTS, because the two platforms offer different things (#484). On
// Android the browser has a sheet and this is a button that opens it. On iOS
// there is no sheet to open and no way to ask for one, so the line NAMES THE
// TWO TAPS — that sentence is the entire product here, and it is the
// difference between an app that is installable and one that gets installed,
// on a platform that hides the option inside a share menu.

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

export default function InstallOffer({ variant = 'prompt', onInstall, onDismiss }) {
  const ios = variant === 'ios'
  return (
    <div className="shell__install" data-testid="install-offer" data-variant={variant}>
      <span className="shell__install-text">
        {ios ? (
          // The two taps, named. `<strong>` on the control names rather than
          // the whole sentence: what the person has to FIND is the Share
          // button, and the sentence around it is instructions for finding it.
          <>
            Add Taskr to your home screen: tap <strong>Share</strong>, then{' '}
            <strong>Add to Home Screen</strong>
          </>
        ) : (
          'Install Taskr on this phone'
        )}
      </span>
      {/* One group, so the two answers stay together if a width ever forces
          a wrap — measured at 360px without it: Install beside the sentence,
          Not now alone underneath. On iOS there is one answer, because there
          is nothing for a second button to do: the install happens in Safari's
          own menu, and a button that could not open it would be a lie. */}
      <span className="shell__install-actions">
        {ios ? null : (
          <button type="button" className="button" onClick={onInstall}>
            Install
          </button>
        )}
        <button type="button" className="button button--quiet" onClick={onDismiss}>
          Not now
        </button>
      </span>
    </div>
  )
}

InstallOffer.propTypes = {
  /** `'prompt'` (Android, a captured event) or `'ios'` (Safari, instructions). */
  variant: PropTypes.oneOf(['prompt', 'ios']),
  // Required on the prompt variant and meaningless on the iOS one, where no
  // button reaches it. A plain `.isRequired` would have had #484's call site
  // passing a handler nothing can call, and a plain `.func` would have stopped
  // asking on the variant that needs it — so the rule is written out.
  onInstall: (props, name, component) =>
    props.variant !== 'ios' && typeof props[name] !== 'function'
      ? new Error(`${component}: \`${name}\` is required unless \`variant\` is "ios".`)
      : null,
  onDismiss: PropTypes.func.isRequired,
}
