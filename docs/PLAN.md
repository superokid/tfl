# Plan: TfL Status vs Reality

For every TfL rail line, compare the official status with live arrival predictions at 2 check stations.
Flag lines where they disagree. Bus routes are checked when searched.

## Rules

**Gap** = longest wait between predicted trains (including now → next train), per direction.
**Too long** = over `max(2 × normal, normal + 5 min)`. The normal gap comes from TfL's timetable.

| Verdict | When |
|---|---|
| Hidden disruption | TfL says Good Service, but 2 stations show gaps that are too long |
| Stale alert | TfL says Suspended, but trains are running; or Severe Delays, but frequency is normal |
| Match | Trains agree with the status |
| Can't verify | Data missing, empty, frozen or failed; no reliable normal gap. Never guesses "fine". |
| Closed | Outside hours or planned closure |

Each flag shows its evidence: *"TfL says Good Service, but the next train at Euston is 14 min away
(usually 3)."*

## Build

- Cloudflare Worker + React. Live data is fetched on request, shared via D1 for 15 s and refreshed in
  the background; no polling.
- TfL down → last result with its age. Offline → last result on the device.
- < 80 KB, no map, works at 320 px. Key only in Wrangler secrets. CI on every push.
