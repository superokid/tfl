# ADR-004: Text-first list, no map

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The tool must be "fast and clean on a phone". Its job is a comparison: *TfL says X, services show Y*.

## Decision
A mobile-first list. Mismatch cards come first, each comparing "TfL says" with "Services show" in plain
English, with the evidence one tap away. Matching lines are collapsed below. No map.

## Alternatives considered
| Option | Why not |
|---|---|
| Geographic map (Leaflet/Mapbox) | Hundreds of KB of library code and tiles; pinch-zoom is awkward on a phone; the user has to hunt for the mismatch. |
| Recreating the Tube diagram | TfL's map design and roundel are protected, and the open-data terms forbid implying endorsement. |
| Per-line station strip diagram | A good extra for showing gaps visually; deferred, and listed as a possible enhancement. |

## Consequences
- The bundle stays under the 50 KB budget, and the important information is visible without interaction.
- Fully accessible as semantic HTML.
- Less visual "wow"; the strip diagram is the path to adding it later without a map's weight.
