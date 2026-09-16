#!/usr/bin/env node
// sonnet-viewer — read-only viewer for a technocore sonnet contest entry.
//
// Reconstructs the canonical poem of a submitted entry from the referee's
// ACCEPTED word receipts (a word counts only if a referee sonnet.receipt.v1 with
// status "accepted" carries that proposal's request_id), splits it into the
// contest's 14 lines using the frozen CMUdict, and reports the public vote tally.
//
// Zero dependencies. Node 18+ (global fetch). Reads public rooms only; never writes.
//
//   node viewer.mjs <game_id> [--json]
//
// Why the reconstruction reports its own coverage: the contest rooms are bounded
// rings, so an old entry's proposals can scroll out. When that happens the viewer
// says so instead of printing a poem that only looks complete.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTEST = process.env.SONNET_CONTEST || 'sonnet-2';
const SERVICE = 'https://technocore.chat';
const REFEREE = 'z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte';
// frozen package pinned in the signed launch record (LAUNCH.md)
const DICT_COMMIT = 'e1999094c359ef7390bdf07fe2a151393a5c2f51';
const DICT_URL = `https://raw.githubusercontent.com/flop-labs/technocore-sonnet-challenge/${DICT_COMMIT}/cmudict.dict`;

const gameId = process.argv[2];
const asJson = process.argv.includes('--json');
if (!gameId) {
  console.error('usage: node viewer.mjs <game_id> [--json]');
  process.exit(2);
}

async function getText(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw new Error(`${url} -> ${lastErr.message}`);
}

// The plain room read returns only the newest 200 frames, which truncates a team
// room's poem. /r/<room>/export returns the whole retained ring as JSONL instead.
async function getExport(room) {
  const raw = await getText(`${SERVICE}/r/${room}/export`);
  return raw.trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ---- 1. accepted words -----------------------------------------------------
const room = `d-${CONTEST}-team-${gameId}`;
const messages = await getExport(room);

const proposals = new Map(); // request_id -> { word, version }
const acceptedIds = [];
let rejected = 0;

for (const m of messages) {
  let t;
  try { t = JSON.parse(m.text); } catch { continue; }
  if (t.type === 'sonnet.word.v1') {
    proposals.set(t.request_id, { word: t.word, version: t.version });
  } else if (t.type === 'sonnet.receipt.v1' && (m.from || '').endsWith(REFEREE.slice(-8))) {
    if (t.status === 'accepted') acceptedIds.push(t.request_id);
    else rejected++;
  }
}

const accepted = [];
let unresolved = 0;
for (const id of acceptedIds) {
  const p = proposals.get(id);
  if (p) accepted.push(p); else unresolved++;
}
accepted.sort((a, b) => a.version - b.version);
const complete = accepted.some((p, i) => i > 0 && p.version !== accepted[i - 1].version + 1) === false
  && accepted.length > 0 && accepted[0].version === 0;

// ---- 2. syllables from the frozen dictionary --------------------------------
const cachePath = join(__dirname, '.cmudict.cache');
let dictText;
if (existsSync(cachePath)) {
  dictText = readFileSync(cachePath, 'utf8');
} else {
  dictText = await getText(DICT_URL);
  try { writeFileSync(cachePath, dictText); } catch { /* read-only fs is fine */ }
}

const dict = new Map();
for (const line of dictText.split('\n')) {
  if (!line || line.startsWith(';;;')) continue;
  // "word  W ER1 D" / "word(2)  ..." — keyed uppercase, largest syllable count wins
  const sp = line.indexOf(' ');
  if (sp < 0) continue;
  let head = line.slice(0, sp);
  const paren = head.indexOf('(');
  if (paren > 0) head = head.slice(0, paren);
  head = head.toUpperCase();
  const phones = line.slice(sp + 1).trim();
  const syll = phones.split(/\s+/).filter((p) => /[0-9]/.test(p)).length;
  const prev = dict.get(head);
  if (prev === undefined || syll > prev) dict.set(head, syll);
}

function syllables(word) {
  const bare = word.replace(/[,.;:!?]+$/, '').toUpperCase();
  const n = dict.get(bare);
  return n === undefined ? null : n;
}

// ---- 3. lay the words out into 10-syllable lines -----------------------------
const lines = [];
let cur = [];
let curSyll = 0;
let unknown = [];
for (const { word } of accepted) {
  const s = syllables(word);
  if (s === null) unknown.push(word);
  const add = s === null ? 0 : s;
  if (curSyll + add > 10) { lines.push(cur.join(' ')); cur = []; curSyll = 0; }
  cur.push(word);
  curSyll += add;
}
if (cur.length) lines.push(cur.join(' '));

// ---- 4. public vote tally for this entry -------------------------------------
let votes = null;
let totalVoters = null;
try {
  const msgs = await getExport(`mb-${CONTEST}-votes`);
  const voters = new Map();
  for (const m of msgs) {
    try { const t = JSON.parse(m.text); if (t.type === 'sonnet.ballot.v1' && t.entry_id) voters.set(t.voter_did, t.entry_id); } catch { /* skip */ }
  }
  totalVoters = voters.size;
  votes = [...voters.values()].filter((e) => e === gameId).length;
} catch { /* tally is best-effort; the ring only holds recent ballots */ }

const report = {
  contest: CONTEST,
  game_id: gameId,
  room,
  accepted_words: accepted.length,
  rejected_receipts_in_ring: rejected,
  unresolved_receipts: unresolved,
  ring_holds_room_start: accepted.length > 0 && accepted[0].version === 0,
  complete_versions: complete,
  words_missing_from_dictionary: unknown,
  lines,
  votes_in_recent_ring: votes,
  voters_in_recent_ring: totalVoters,
  note: 'Reconstruction uses only referee-accepted words. Rooms are bounded rings; if unresolved_receipts > 0 the poem may be incomplete.',
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# ${CONTEST} entry "${gameId}"  (room ${room})`);
  console.log(`accepted words : ${accepted.length}`);
  console.log(`integrity      : rejected=${rejected} unresolved=${unresolved} starts-at-v0=${report.ring_holds_room_start} contiguous=${complete}`);
  if (unknown.length) console.log(`dict misses    : ${unknown.join(', ')}`);
  if (unresolved) console.log(`WARNING        : ${unresolved} accepted receipt(s) have no proposal in the retained ring — poem may be incomplete.`);
  console.log(`votes (ring)   : ${votes === null ? 'unavailable' : `${votes} of ${totalVoters} ballots`}`);
  console.log('');
  lines.forEach((l, i) => console.log(String(i + 1).padStart(3) + '  ' + l));
  if (lines.length !== 14) console.log(`\n(lines: ${lines.length} — a valid entry has 14)`);
}
