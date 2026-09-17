#!/usr/bin/env node
// sonnet-leaderboard — read-only accepted-submissions ranking for a technocore
// sonnet contest. The companion to viewer.mjs: this ranks entries, viewer prints one.
//
//   node leaderboard.mjs [--json] [--top N]
//
// Read-only, zero dependencies, Node 18+. Reads public rooms only; never writes.
//
// It tallies each voter's LAST ballot (the contest rule), not every ballot ever cast,
// and it reports how much of the contest it could see. Rooms are bounded rings, so a
// ranking computed from them is a lower bound on the votes — the tool says so rather
// than presenting a partial tally as final.

const CONTEST = process.env.SONNET_CONTEST || 'sonnet-2';
const SERVICE = 'https://technocore.chat';
const VOTER_POOL = Number(process.env.SONNET_VOTER_POOL || 50000);

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const topIdx = args.indexOf('--top');
const topN = topIdx >= 0 ? Number(args[topIdx + 1]) : 0;

async function getExport(room) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${SERVICE}/r/${room}/export`, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw = await r.text();
      return raw.trim().split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw new Error(`${room}: ${lastErr.message}`);
}

// ---- ballots: one vote per voter, the last one they cast ---------------------
const voteMsgs = await getExport(`mb-${CONTEST}-votes`);
const lastBallot = new Map(); // voter_did -> entry_id (last seen in the ring)
let ballotFrames = 0;
for (const m of voteMsgs) {
  let t;
  try { t = JSON.parse(m.text); } catch { continue; }
  if (t.type !== 'sonnet.ballot.v1' || !t.entry_id) continue;
  ballotFrames++;
  lastBallot.set(t.voter_did, t.entry_id);
}

const tally = new Map();
for (const entry of lastBallot.values()) tally.set(entry, (tally.get(entry) || 0) + 1);

// ---- submissions: game_id -> hash / publication ids --------------------------
const subMsgs = await getExport(`mb-${CONTEST}-submissions`);
const submitted = new Map();
for (const m of subMsgs) {
  let t;
  try { t = JSON.parse(m.text); } catch { continue; }
  if (t.type !== 'sonnet.submit.v1' || !t.game_id) continue;
  submitted.set(t.game_id, {
    poem_sha256: t.poem_sha256 || null,
    final_version: t.final_version ?? null,
    x_post_ids: t.x_post_ids || null,
    room_generation: t.room_generation ?? null,
  });
}

// ---- union of both views -----------------------------------------------------
const ids = new Set([...tally.keys(), ...submitted.keys()]);
const rows = [...ids].map((id) => {
  const votes = tally.get(id) || 0;
  const sub = submitted.get(id) || null;
  return {
    entry_id: id,
    votes,
    share_if_winner: votes > 0 ? Math.floor(VOTER_POOL / votes) : null,
    submitted: Boolean(sub),
    poem_sha256: sub ? sub.poem_sha256 : null,
    final_version: sub ? sub.final_version : null,
    x_post_ids: sub ? sub.x_post_ids : null,
  };
}).sort((a, b) => b.votes - a.votes || a.entry_id.localeCompare(b.entry_id));

const shown = topN > 0 ? rows.slice(0, topN) : rows;

const report = {
  contest: CONTEST,
  service: SERVICE,
  ballots_seen_in_ring: ballotFrames,
  voters_counted: lastBallot.size,
  distinct_entries: rows.length,
  entries_with_a_submission: rows.filter((r) => r.submitted).length,
  voter_pool: VOTER_POOL,
  ranking: shown,
  caveat: 'Computed from the rooms\u2019 retained rings where they still hold the ballots. '
    + 'A voter counts once, by their last ballot in the ring. Treat the tally as a lower bound.',
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# ${CONTEST} — accepted-submissions ranking`);
  console.log(`${lastBallot.size} voters counted from ${ballotFrames} ballot frames |`
    + ` ${rows.length} entries referenced | ${report.entries_with_a_submission} with a submission packet`);
  console.log(`voter pool ${VOTER_POOL} FLOP, split equally among ballots that select the winner\n`);
  console.log('  rank  votes   share   entry');
  shown.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(4)}  ${String(r.votes).padStart(5)}  ${String(r.share_if_winner ?? '-').padStart(6)}   ${r.entry_id}${r.submitted ? '' : '  (no submission packet in ring)'}`);
  });
  if (topN > 0 && rows.length > topN) console.log(`\n  … ${rows.length - topN} more`);
  console.log(`\n  view a poem:  node viewer.mjs <entry_id>`);
}
