import { buildInfo } from './buildInfo.js'

// The shell, and deliberately only the shell. Story #4 ships "the app exists at a
// real URL and installs on a phone"; the household load view is #7, the roster is
// #5. Anything more here would be feature work smuggled into a deploy story.
export default function App() {
  return (
    <main className="shell">
      <h1 className="shell__title">Taskr</h1>
      <p className="shell__tagline">
        Chores are minutes of work. People are budgets of minutes. The split is
        proportional to what each person actually has.
      </p>

      <section className="shell__status" aria-labelledby="status-heading">
        <h2 id="status-heading" className="shell__status-heading">
          Shell deployed
        </h2>
        <p className="shell__status-body">
          The household view arrives in a later story. This page exists so
          everything after it ships onto something live.
        </p>
      </section>

      <footer className="shell__footer">
        <span>{buildInfo.name}</span>
        <span aria-hidden="true"> · </span>
        <span>{buildInfo.env}</span>
      </footer>
    </main>
  )
}
