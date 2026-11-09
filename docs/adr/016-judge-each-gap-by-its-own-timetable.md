# ADR-016: Judge each gap against the timetable where it falls

## Context
Sunday night, the Tram was flagged at East Croydon for a 14 min gap. TfL's own timetable has 15 min
between the last two trams (01:02 → 01:17). The rule took one normal gap at the moment of the check (an
hourly median, 6) and applied it to the whole look-ahead, so a gap in the next, sparser hour got threshold 12.

Daytime had the same root: trams come in pairs where branches merge (1 min, then 6–7). The median is 4, but
passengers routinely wait 7, so 9.4 min was flagged against 9 (`docs/verification.md`, 8 Nov).

## Decision
- The reference keeps, per hour, the median **and** the longest scheduled gap (`longestGapMin`).
- Each observed gap is judged by the hours it overlaps: `max(2 × median, longest + 5)`, taking the largest
  of each. The gap furthest over its own threshold is reported.
- Evidence says "usually up to N" when the timetable's longest gap exceeds its median.

## Consequences
- East Croydon Sunday 00:50: threshold 20 for the last gap, so 14 is not flagged. A 14 min gap at 20:00
  (6–8 min service) still is (threshold 13). Paired trams by day: threshold 12, not 9.
- Evenly spaced lines barely change (longest ≈ median).
- `rail.json` grows from 66 KB to 118 KB (more bands, one more field). Worker only, not the client bundle.
- `SNAPSHOT_VERSION` 5: stored checks carry the new evidence field.
- Not fixed here: Elizabeth line and Overground still have no timetable (fallback gap, never flagged).
