# ADR-008: Station search with live departures (replaces bus search)

## Context
The page should be usable instead of TfL's site: passengers want next trains at *their* station, not only at
our 2 check stations per line. Buses were planned as on-demand checks (ADR-003).

## Decision
- `bun run reference` also writes `stations.json`: 457 rail stations from route sequences (both directions),
  hub stations merged (Stratford = Tube + DLR + rail stop ids). Served by `/api/stations` (cached a day), so
  typing never calls TfL.
- `/api/station/:id`: validated against the index; one TfL call per stop id (≤ 4); 30 s edge cache; last
  good copy served stale on failure. Boards group by **physical platform**, because TfL's `direction` is
  sometimes wrong (Elizabeth line at Stratford lists eastbound Gidea Park trains as "outbound").
- Each line at the station shows its TfL status, message and our verdict from the main snapshot.
- Bus routes are not included yet.

## Alternatives
| Option | Why not |
|---|---|
| TfL `/StopPoint/Search` per keystroke | TfL calls and Worker requests on every key |
| Hub ids (`HUBSRA`) for arrivals | Return nothing; member stop ids work |
| Group boards by TfL `direction` | Wrong at Stratford; merges branch platforms |

## Consequences
- Any rail station's departures in one tap; a search costs 0 TfL calls, a station view 1–4.
- The index goes stale like the reference data; regenerate with `bun run reference`.
