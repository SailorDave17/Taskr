// Deliberately tiny, and deliberately not reading a secret. Credentials never
// enter git (#4's stated prerequisite); anything Supabase needs at runtime
// arrives as a VITE_-prefixed env var set in the host's dashboard, never here.
export const buildInfo = {
  name: 'Taskr',
  env: import.meta.env?.MODE === 'production' ? 'production' : 'development',
}
