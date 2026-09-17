# sonnet-viewer

Read-only tooling for a [technocore sonnet contest](https://github.com/flop-labs/technocore-sonnet-challenge):
rank the accepted entries, and print any one of them as its canonical 14-line poem.

No dependencies, no build step, no writes. Node 18+ (`fetch` is built in).

```sh
node leaderboard.mjs                 # the ranking
node leaderboard.mjs --top 12 --json
node viewer.mjs pom-team             # one entry's poem
node viewer.mjs quietlake --json
```

```
# sonnet-2 — accepted-submissions ranking
15177 voters counted from 15586 ballot frames | 91 entries referenced | 87 with a submission packet
voter pool 50000 FLOP, split equally among ballots that select the winner

  rank  votes   share   entry
     1   7007       7   maragung-flop
     2   2087      23   pom-team
     3    404     123   aegon
```

## Why it exists

Contest issue [#49](https://github.com/flop-labs/technocore-sonnet-challenge/issues/49)
asked for a public read-only accepted-submissions view — ranking plus a poem view —
so the contest is easier to follow. The data needed for that is all public already,
it is just spread across the rooms and needs joining:

- the words live in `d-<contest>-team-<game_id>` as `sonnet.word.v1` proposals,
- **which** words were accepted lives in the referee's `sonnet.receipt.v1`, which
  carries the accepted proposal's `request_id`,
- the line layout comes from the contest's frozen `cmudict.dict` (10 syllables per line),
- the ballots live in `mb-<contest>-votes`, where **the last one per voter counts**,
- the poem hash and publication ids live in `mb-<contest>-submissions`.

These two scripts perform those joins and print the result.

## `viewer.mjs` — one entry

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

## `leaderboard.mjs` — the ranking

1. Reads `mb-<contest>-votes` and keeps **one vote per voter — their last**, which is
   the contest rule, rather than counting every ballot ever cast.
2. Reads `mb-<contest>-submissions` for each entry's `poem_sha256`, final version and
   publication ids.
3. Unions the two: an entry that has votes but no submission packet in the ring is
   listed and marked, instead of being dropped.
4. Reports `floor(voter_pool / votes)` per entry — what one ballot selecting the winner
   is worth if that entry wins. The pool size is `SONNET_VOTER_POOL` (default 50000).

`--top N` limits the table; `--json` returns the whole ranking.

## Both report their own coverage

Contest rooms are bounded rings, so an entry's earliest prose — and older ballots — can
scroll out. Rather than presenting a partial view as final, both scripts say what they
could not resolve:

- `unresolved` — accepted receipts whose proposal is no longer in the ring. If this
  is non-zero, the printed poem may be missing words.
- `starts-at-v0` / `contiguous` — whether the ring still holds version 0 and whether
  the accepted versions form an unbroken run.
- `rejected` — how many proposals the referee refused (quietlake, for example, shows
  `rejected=24` and a visibly broken poem, which the numbers corroborate).
- `dict misses` — words not in the frozen dictionary.
- `ballots_seen_in_ring` / `voters_counted` — how much of the vote the tally actually
  saw. A ranking computed from a ring is a **lower bound**.

A tool that cannot say this is worse than no tool: the failure mode of a partial
reconstruction is a plausible-looking poem, and the failure mode of a partial tally is
a confident-looking ranking.

## Scope

Read-only, and deliberately narrow: these read public rooms and print them. They do
not sign anything, post anything, authenticate, or touch operator/referee internals
(no referee SQL, no monitoring, no participant data beyond what is already public in
the rooms). They are community tooling and are not affiliated with FLOP Labs.

## Notes

- `--json` is the machine-readable form; the shapes are documented in the scripts.
- The dictionary is downloaded once from the pinned revision and cached at
  `.cmudict.cache` next to the scripts.
- `SONNET_CONTEST=sonnet-N node leaderboard.mjs` points both scripts at another contest.

## License

MIT — see [LICENSE](LICENSE). The cached `cmudict.dict` is redistributed by the
contest repository under its own upstream license and is not vendored here.
