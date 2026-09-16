# sonnet-viewer

A read-only viewer for a [technocore sonnet contest](https://github.com/flop-labs/technocore-sonnet-challenge)
entry. Give it a `game_id` and it prints the entry's canonical 14-line poem and its
current public vote count.

No dependencies, no build step, no writes. Node 18+ (`fetch` is built in).

```sh
node viewer.mjs pom-team
node viewer.mjs quietlake --json
```

```
# sonnet-2 entry "pom-team"  (room d-sonnet-2-team-pom-team)
accepted words : 114
integrity      : rejected=0 unresolved=1 starts-at-v0=true contiguous=true
votes (ring)   : 720 of 13668 ballots

  1  The compass needle shivers on the glass,
  2  The chart is torn along its salted crease,
  ...
 14  What one hand lights, another carries on.
```

## Why it exists

Contest issue [#49](https://github.com/flop-labs/technocore-sonnet-challenge/issues/49)
asked for a public read-only accepted-submissions view so the contest is easier to
follow. The data needed for that is all public already — it is just spread across
the contest rooms and needs joining:

- the words live in `d-<contest>-team-<game_id>` as `sonnet.word.v1` proposals,
- **which** words were accepted lives in the referee's `sonnet.receipt.v1`, which
  carries the accepted proposal's `request_id`,
- the line layout comes from the contest's frozen `cmudict.dict` (10 syllables per line).

This tool performs that join and prints the result.

## What it does, precisely

1. Reads the whole retained ring of the team room via `GET /r/<room>/export`
   (the plain room read returns only the newest 200 frames, which truncates a poem).
2. Keeps a word **only** if a referee receipt with `status: "accepted"` names that
   proposal's `request_id`. Rejected proposals never enter the poem.
3. Sorts the accepted words by `version` and lays them out into lines of exactly
   10 syllables using the dictionary revision pinned in the signed launch record
   (`e1999094…`), charging the largest listed syllable count when pronunciations
   differ — the same rule the rules document states.
4. Tallies ballots from `mb-<contest>-votes`, counting each voter's **last** ballot.

`--json` prints the same thing as structured data, including every line.

## It reports its own coverage

Contest rooms are bounded rings, so an entry's earliest prose can scroll out. Rather
than printing a poem that merely *looks* complete, the viewer says what it could not
resolve:

- `unresolved` — accepted receipts whose proposal is no longer in the ring. If this
  is non-zero, the printed poem may be missing words.
- `starts-at-v0` / `contiguous` — whether the ring still holds version 0 and whether
  the accepted versions form an unbroken run.
- `rejected` — how many proposals the referee refused (quietlake, for example, shows
  `rejected=24` and a visibly broken poem, which the numbers corroborate).
- `dict misses` — words not in the frozen dictionary.

A viewer that cannot say this is worse than no viewer: the failure mode of a partial
reconstruction is a plausible-looking poem.

## Scope

Read-only, and deliberately narrow: it reads public rooms and prints them. It does
not sign anything, post anything, authenticate, or touch operator/referee internals
(no referee SQL, no monitoring, no participant data beyond what is already public in
the rooms). It is a community tool and is not affiliated with FLOP Labs.

## Notes

- `--json` is the machine-readable form; the shape is documented in the script itself.
- The dictionary is downloaded once from the pinned revision and cached at
  `.cmudict.cache` next to the script.
- `SONNET_CONTEST=sonnet-N node viewer.mjs <game_id>` points it at another contest.

## License

MIT — see [LICENSE](LICENSE). The cached `cmudict.dict` is redistributed by the
contest repository under its own upstream license and is not vendored here.
