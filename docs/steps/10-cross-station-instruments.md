# Step 10: Cross-station instruments

Status: todo
Depends on: 07 (08 recommended, so they can be placed from the bay)
Read first: [ADR-0005](../adr/0005-config-document.md), `web/README.md` (instrument authoring)

## Context

With single-process uvicorn servers, each station has one node, so the per-station nodes grid
and fleet strands are nearly empty. Across several stations, the interesting view is the set of
servers.

## Goal

Instruments with `scope: 'device'` that show every station at once. They're built on the
existing shaders and vector painter, with no new rendering pipeline.

## Instruments

| Type | Based on | Reads as |
|---|---|---|
| `stationBoard` | the nodes lamp shader (`matrix.js`) | One large lamp per station, engraved with its name. The fill is saturation, the colour is the system state. STALE stations are dark and struck through. Optional small numerals for P50 and RPS. |
| `stationRadar` | `radar.js` | One contact per station. The bearing is fixed by station order, and the range is headroom (worst of P50 vs crit, error rate vs errCrit, saturation vs satCrit). |
| `stationStrands` | `fleet.js` | One latency strand per station over the last 3 min, each normalised to its own crit threshold, so stations with different scales are comparable. |
| `stationLog` | `log` with `station: 'all'` (step 06) | Already exists. Register it in the bay under this group. |

## Tasks

1. Registry support for `scope: 'device'`: these instruments receive the station manager (or a
   read-only list of stations) instead of one station, and they re-render when stations are
   added or removed.
2. Implement the three new instruments. Keep their per-frame cost bounded for at least 16
   stations.
3. Add a page "Fleet" to the Docker default document (`deploy/config/mars.json`) that uses them.
4. Document them in the `web/README.md` instrument tables.

## Acceptance criteria

- [ ] With the demo stack, the Fleet page shows both stations. Chaos on one turns its lamp and
      contact amber or orange. Stopping one turns it dark (STALE).
- [ ] With 16 sim stations (an example config), the frame time stays within 10 % of the
      2-station case. Report the numbers.
- [ ] Adding or removing a station in the stations plate updates these instruments live.
- [ ] vitest and smoke pass.

## Out of scope

Per-station instrument changes.
