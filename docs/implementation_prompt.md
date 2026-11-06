# Implementation prompt

Copy everything below the line into a fresh agent session, run from the repository root.
To run a particular step, replace `NEXT` with the step number (for example `07`). Otherwise
the agent picks the next step itself.

---

You are implementing one step of the MARS project (Monitor Any Remote System): a
cassette-futurist monitoring display (`web/`), a Python instrumentation package (`probe/`), a
demo service (`examples/demo/`) and a Docker stack (`deploy/`). The plan lives in `docs/`.

**Step to implement: NEXT**

## 1. Orient yourself

1. Read `docs/README.md` completely. It has the step table, the rules for agents and the
   conventions.
2. Choose the step:
   - If a number is given above, use `docs/steps/<NN>-*.md`.
   - If it says `NEXT`, take the lowest-numbered step file with `Status: todo` whose
     dependencies (the `Depends on:` line) are all `Status: done`. If there is none, stop and
     report which steps are blocked and why.
   - Check the dependencies either way. If one isn't done, stop and report it. Don't implement
     it as well.
3. Read the step file, then every document under its **Read first**, then the `## Handoff`
   sections of the steps it depends on. Handoffs record deviations from the plan, and they
   override the original step text where the two disagree.
4. Read `docs/open-questions.md`.
5. Look at the code you'll touch before you change it. Run the existing checks (build, tests,
   smoke) once **before** you start, so you know the baseline. If the baseline is already
   broken, record it, and decide whether fixing it is in scope. Usually it isn't, so note it and
   go on.

## 2. Plan briefly

Write a short plan (5–15 bullets) that maps every task and acceptance criterion in the step to
concrete changes. Note anything in the step that is ambiguous, or that conflicts with the
current code or an ADR:
- If you can settle it with a reasonable choice that stays within the step's scope and doesn't
  contradict an ADR, do so, and record the choice in the handoff.
- If it would change an ADR contract (metric names, recording rules, config schema, layout
  grid), you may change it, but only by editing the ADR in the same commit and calling it out in
  the handoff.
- If it needs the user's judgement and blocks the step, stop and ask.

## 3. Implement

- **Stay inside the step's scope.** Anything outside it goes into `docs/open-questions.md` (or
  the handoff as "suggested follow-up"). Don't implement it.
- **Match the surrounding code:** plain JS and React 18 in `web/`. Python 3.11+, uv, ruff and
  pytest in `probe/` and `examples/`. Small modules, comments that explain *why*, and the same
  comment density and naming as the files around them.
- **Keep the design rules:** the housing is a physical Braun-style device, colour is signal only
  (mint for nominal, amber for warn, orange for critical), every screen goes through the shared
  CRT pipeline, and nothing that looks like a generic web UI control appears unstyled.
- **Don't break existing behaviour** unless the step says to. The built-in default document and
  `npm run smoke` are the regression baseline.
- **Keep commits small,** at most a few per step, each one building.
- Don't add dependencies that aren't named in the step or an ADR without saying why in the
  handoff.

## 4. Verify

- Run every command under the step's **Verification**, plus every check that exists by then:
  - `cd web && npm run build && npm test && npm run smoke` (whichever exist)
  - `cd probe && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
  - promtool rule tests
  - `docker compose -f deploy/compose.yaml config`
- Go through the acceptance criteria one by one. Tick each checkbox in the step file only once
  you have actually seen it pass. If a criterion needs a running stack or a person looking at it
  (screenshots), do what you can (start the stack, take screenshots with Playwright, query
  Prometheus) and say precisely what still needs a person.
- **Never** tick a box, or claim something works, that you didn't verify. A failing or skipped
  check is reported as failing or skipped, with its output.

## 5. Hand off

1. In the step file:
   - set `Status: done`. If criteria remain unmet, set `Status: partial` instead, and list them.
   - append a `## Handoff` section with:
     - **Built:** what exists now, with the key files as relative links
     - **Deviations:** every difference from the step text and why
     - **Verification:** the commands run and their relevant output (trimmed), and the
       screenshot paths
     - **Not verified / needs a person:** an explicit list
     - **Notes for later steps:** traps, new interfaces, decisions to respect
2. In `docs/open-questions.md`: add new questions under their area, and move questions you
   answered to **Resolved** with the date and the step.
3. If you made an architectural decision not covered by an ADR, add `docs/adr/NNNN-<slug>.md` in
   the format of the existing ones.
4. If your work changes how something is run or used, update the README files (root, `web/`,
   `probe/`, `deploy/`).
5. Commit with the message `step NN: <step title>`, plus the attribution trailer if your
   environment requires one. Don't push.

## 6. Final message

Reply with:
- the step and its final status
- 3–6 bullets on what was built
- deviations and decisions the user should know about
- anything unverified or failing, with the reason
- the next runnable step(s)
