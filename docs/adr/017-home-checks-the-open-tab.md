# ADR-017: The home screen checks the open tab's lines

Refines ADR-011: still on request, never polled, but the home screen checks live trains again.

## Context
After ADR-011 the home screen showed a mismatch only from a check-all result under 10 min old, and no
screen ran one. So it effectively never showed one: most passengers saw TfL's status unchecked, and a
line with no note looked the same as a line that matched.

## Decision
- `GET /api/checks/:tab` (tube, elizabeth-line, overground, dlr, tram): live checks of that tab's lines
  only, verdicts only. One D1 snapshot per tab (`checks:<tab>`), with the same lease and
  stale-while-revalidate as `/api/lines`.
- The home screen fetches it for the open tab, after the statuses (they show first). Not saved on the
  device: an old verdict misleads.
- Every row says what the check found: a mismatch, "Live trains match", or "Live trains not checked"
  (couldn't check, or no result). Closed lines say nothing extra.
- `/api/lines` no longer carries verdicts. `/api/checks` (every line) stays for verification by hand.

## Consequences
- TfL calls per refresh: Tube ≤ 24 (2 status + 2 per line), Overground ≤ 14, the others ≤ 4. At most one
  refresh per tab per 30 s however many viewers; none for a tab nobody has open.
- Measured in dev: Tube 6.9 s cold (24 calls, 6 in flight), then 28 ms from D1. Statuses still show first.
- D1: 2 writes per refresh per tab. Worst case, every tab open all day: ~34,600/day with `lines` (free tier
  100,000, shared with other sites). Realistically the Tube tab dominates (~11,500/day if never closed).
