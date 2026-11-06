# ADR-0007: Nodes, routes, stages and regions that appear at runtime

Status: accepted · 2026-11-06 (step 07)

## Context

A Prometheus station discovers its nodes (`instance`), routes, pipeline stages and client
regions from label values when it starts ([ADR-0003](0003-metric-contract.md)). The
telemetry store sizes its tables from that: typed arrays per node, one object per route and
region, the per-node latency history. All of these can change while the display runs: a
deploy adds a route, autoscaling adds a node, a new client region shows up.

Step 07 suggested rediscovering every 5 minutes and rebuilding the station when the sets
changed. The open-questions review (2026-11-06) decided on spare slots instead, so that a new
label doesn't throw away the short-term state of everything else.

## Decision

- **Spare slots.** After discovery the store gets room for more entries than were found:
  nodes + max(8, nodes), routes + 8, stages + 4, regions + 8 (`caps` in
  `data/telemetry.js`, sizes in `station/station.js`).
- **Filling.** The live query already returns every `mars:*` series of the station each
  second, so there is no periodic rediscovery. A label that has no slot yet takes the next free
  one (`store.addNode / addEndpoint / addStage / addRegion`), and the log says `NEW ROUTE …`.
  A new route's P95 SLO is twice its first observed P95, because there is no 4-hour history
  for it yet. A new stage gets the mean share until it is relearned at the next discovery.
  Region codes not in `data/regions.js` never take a slot.
- **Instruments read the tables every frame** (radar, contacts, pipeline, ground track,
  origins, nodes, fleet, slices), so a filled slot shows up without rebuilding anything.
- **Overflow.** When a label finds no free slot, the store logs `SLOTS FULL …` and the station
  **rebuilds**: it stops its source, rediscovers, makes a new store with twice the spare slots
  per rebuild so far, and refills the tape from Prometheus. Its screens show TAPE RELOAD in
  the meantime. Panels rebuild their instruments because the station's `generation` changes.
  The almanac is kept. After 4 rebuilds the station stops rebuilding, keeps the overflow
  showing, and asks for a reload.
- **The overflow lamp** is the `SLOTS USED` row of the Caution & Warning panel, which Prometheus
  stations have: used/capacity across the four tables. It is amber above 75 % or once the
  station has been rebuilt (`RBLT`), and orange (`FULL`) while overflowing.
- **Entities that go away keep their slot.** A node that leaves Prometheus (absent from the
  live answer) shows as offline. A route without traffic shows NO DATA. A reload or a rebuild
  drops them, because discovery only looks back 1 h for nodes and 4 h for routes.

## Consequences

- A new node or route appears within a second, and nothing else on the display resets.
- A vanished node counts as DOWN on the C&W panel until the next reload. That is honest for a
  crash but wrong for a scale-down. See open questions.
- Memory is bounded by the caps: at most twice the discovered node count, which is a few kB.
