# License scope — what `LICENSE` does and does not cover

- Date: 2026-08-04
- Decided by: owner (SailorDave17), at grooming of epic #2 / story #3
- Applies from: the first commit on `rebuild/v1`

## The rule

**`LICENSE` (MIT, © 2026 David Alvarado) covers newly written rebuild code only.**

**The legacy code remains unlicensed and is reference-only.** It is not relicensed, not
redistributable under MIT, and must not be copied into the rebuild.

## Why the distinction exists

Taskr began as a GitHub Classroom team project (2020-Fall-Cohort) with **five contributors and no
license**. That code is therefore not solely the owner's to relicense — a fact the refresh
assessment recorded as *provenance*, and one of the reasons the verdict was **rebuild from charter**
rather than refactor. See `docs/refresh-charter.md`.

An incremental refactor would have carried the unlicensed co-authored code forward into whatever
license was later applied. A rebuild resolves it structurally: new code is written from the charter,
and the legacy tree is consulted the way you would consult a specification.

## Where the legacy code is, and how it may be used

The full legacy tree is preserved at tag **`legacy-final`** (`7411cea`) and is deliberately left
unrewritten. It may be **read** — for the fairness semantics of
`back-end/src/main/java/com/taskr/core/ResourceManager.java`, for the domain model's nouns, for the
all-users progress view. Read it for intent.

It may **not** be copied, adapted line-by-line, or vendored into `rebuild/v1`. The charter's salvage
inventory is explicit that these are carried "as reference, not as code".

The one asset class flagged with unclear provenance in the charter — the Dad/Bro/Sis/Mom user icons
— is covered by the same rule and should be re-made rather than reused.

## Ordering

The license is a **precondition, not a risk**: nothing in the rebuild may legally precede it. That
is why it lands in the first commit on `rebuild/v1`, alongside the branch cut, rather than in a
later story where inter-story discipline would be the only thing enforcing the order.
