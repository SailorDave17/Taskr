// Deliberately tiny, and deliberately not reading a secret. Credentials never
// enter git (#4's stated prerequisite); anything Supabase needs at runtime
// arrives as a VITE_-prefixed env var set in the host's dashboard, never here.
export const buildInfo = {
  name: 'Taskr',
  env: import.meta.env?.MODE === 'production' ? 'production' : 'development',
  // Set from VERCEL_GIT_COMMIT_SHA by vite.config.js; 'local' anywhere else.
  // This is the only way to answer "which commit is the live site serving?"
  // from outside — deployment dashboards answer about the deployment they were
  // asked about, not about what the URL currently resolves to.
  commit: import.meta.env?.VITE_BUILD_SHA || 'local',
}
