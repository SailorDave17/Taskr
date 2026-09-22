// An insert issued the way PostgREST issues one — #419.
//
// The pglite suites used to spell a client's insert by hand, and a hand copy
// can keep a column the client module has dropped: the column list is typed
// twice and nothing compares the two. This takes the client's OWN payload
// object instead. Its keys are the column list, exactly as PostgREST derives
// one from a JSON body, and the values reach Postgres the way PostgREST hands
// them over — as JSON, cast to each column's type by `json_populate_record`
// against the table's row type — so a `bytea` arrives as its `\x…` text and a
// timestamp as its ISO string, and the cast under test is Postgres's own.
//
// What it does NOT reproduce is PostgREST itself: its request parsing, its
// `Prefer` handling, its schema cache. A pass here is a statement about the
// database's half of the leg, which is the half a grant or a default decides.

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

function identifier(name) {
  if (!IDENTIFIER.test(name)) throw new Error(`not a plain identifier: ${JSON.stringify(name)}`)
  return name
}

/**
 * `insert into public.<table> (<keys of row>) select … from
 * json_populate_record(null::public.<table>, <row as JSON>) returning <returning>`.
 *
 * Every key is inserted, including one whose value is `undefined` — which
 * `JSON.stringify` drops, so it would arrive as a null the column's default
 * never sees. PostgREST names the keys the body carries and nothing else, so
 * a key the caller does not mean to send must not be in the object at all.
 */
export function insertAsPostgrest(db, table, row, returning = 'id') {
  const columns = Object.keys(row).map(identifier)
  if (columns.length === 0) throw new Error('an insert must name at least one column')
  const target = identifier(table)
  return db.query(
    `insert into public.${target} (${columns.join(', ')})
     select ${columns.map((column) => `body.${column}`).join(', ')}
       from json_populate_record(null::public.${target}, $1::json) as body
     returning ${returning}`,
    [JSON.stringify(row)],
  )
}
