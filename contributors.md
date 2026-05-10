
## Architecture at a glance

```
src/
├── engine/              # pure TS state machine
│   ├── state.ts         #   the FSM + applyAction dispatcher
│   ├── matrix.ts        #   bell-curve generation + inversion + variance
│   ├── ai.ts            #   easyActor, mediumActor (hardActor incoming)
│   ├── score.ts         #   standard 0–20 + atlas ordinal modes
│   └── *.test.ts        #   colocated invariant + property tests
├── store/               # Zustand wrapper. Persists every dispatch.
├── components/          # function-component React/Tailwind-styled.
│   ├── Setup/           #   pickers + matrix entry + sheet-paste parser
│   ├── Play/            #   matrix viewer + rosters + step prompt + log
│   ├── GameOver/        #   final slate + transcript export
│   └── Interstitial.tsx #   hot-seat handoff gate
└── App.tsx              # view router (setup / play / game-over)
```

The engine is the source of truth — UI only reads via
`viewFor(state, seat)`, which strips the opposing team's pendings by
construction.

## Working in this repo

The project follows the `agent-skills` lifecycle:

1. `/spec` — write or update the spec under `specs/` first.
2. `/plan` — break the spec into tasks before writing code.
3. `/build` — incremental implementation, one task at a time, tests
   alongside.
4. `/test` — `npm test` must pass before declaring a phase done.
5. `/review` — audit non-trivial changes before merging.
6. `/ship` — only when genuinely done.

The current UI lives in phases U1–U6 (see `specs/002-ui-v1.md`). U7
(animated card / triangle / slate presentation layer) and U8 (Hard AI)
are next.

## Glossary

If you've played WTC team events, skim the **Domain glossary** in
`CLAUDE.md`. The codebase uses these terms verbatim — `defender`,
`attackers`, `refusal`, `tableChoiceToken`, `slate`, etc. — so reading
both names the same thing.
