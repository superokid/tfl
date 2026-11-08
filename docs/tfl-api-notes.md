# TfL API notes

Verified against the live API. `app_key` is a query parameter, so request URLs are secret.

**Status** `/Line/Mode/tube,elizabeth-line,dlr,overground,tram,cable-car/Status`
- 21 lines. A line can have several statuses (Bakerloo: Severe Delays + Part Suspended).
- Waterloo & City on Sunday = Planned Closure.
- `isNow` is unreliable (false inside its own validity period). Use the dates.
- `affectedStops` is empty unless `?detail=true` (Bakerloo Part Suspended: 10 stops).
- `?detail=true` for all rail lines ≈ 307 KB.

**Arrivals** `/Line/{ids}/Arrivals/{stop}`
- Several lines per call works (`bakerloo,central,victoria` at Oxford Circus).
- Horizon varies: Victoria at Oxford Circus 17 min; Elizabeth at Bond St 118 min.
- `direction` is inbound/outbound; `platformName` is e.g. "Northbound - Platform 6".
- `timing.read` is there for frozen-feed checks.
- Cable Car: always `[]`. Tram: 165 predictions.

**Timetable** `/Line/{id}/Timetable/{stop}`
- At a station that isn't a terminus, it needs `?direction=`, or returns only a disambiguation object.
- Victoria from Brixton ≈ 325 KB, schedules Mon–Thu / Fri / Sat / Sun.
- `FrequencyMinutes` is too coarse (one band, 1–5 min). Use `knownJourneys`.

**Bus** `/Line/Mode/bus` ≈ 348 KB.

## To verify
- Horizon per mode, peak and off-peak; how often `timing.read` advances.
- `/Line/Meta/Severity` list; overnight and Night Tube status.
- Ghost trains during a suspension.
- Timetable parse CPU in a Worker (Northern, District); `hour` ≥ 24.
- Key in a header; responses during a partial TfL outage.
