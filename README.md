# THIS OR THAT

A live, phone-controlled this-or-that party game for the **Unified Greek Council (UGC) at VCU**,
built for a room of about 25 people on a projector.

**Live:** https://qwendor.github.io/thisorthat/
**Companion game:** [Spill the Letters](https://qwendor.github.io/spill/) — same studio, same
design system, same networking. This one is built around a slot machine instead of a reveal.

---

## The loop

1. **Two options** go up on the big screen, each with its own pre-generated illustration.
   "Coffee" vs "Energy drink". Big enough to read from the back of the room.
2. **Everyone picks A or B** on their phone. Timer, live count of who is in. You can change your
   mind until the clock runs out.
3. **The split reveals.** The bar slides from 50/50 to the truth — 64% / 36% — and every player's
   name and colour flies to their side.
4. **The spin.** A slot machine picks **one person from each side**, decelerating to a hard stop
   with a thunk. This is the point of the game.
5. **They talk.** 30 seconds each, on-screen timer, their name huge behind them. The two chosen
   phones show **YOU'RE UP** so nobody has to be told.
6. Scoreboard. Next question. Podium and superlatives at the end.

## Scoring

The whole scale is built so a **close call is worth more than an obvious one**, and so getting
spun is upside rather than a tax.

| | | |
|---|---|---|
| **Read the room** | up to **1200** | For landing on the majority side, scaled by how close the split was. `1200 × closeness^1.35`, where closeness is 1 at a dead 50/50 and 0 at unanimous. A 51/49 call pays ~1170. A 64/36 pays ~770. A 96/4 pays 40. A landslide is worth almost nothing to the people who called it, which is the point. |
| **Stood alone** | up to **900** | For being in a small minority — under 30% of the room. Scales with how small: 1 of 25 pays 780, 3 of 25 pays 540, 6 of 25 pays 180. Picking the unpopular option and owning it is worth something. |
| **Took the mic** | flat **700** | For being spun and speaking. Awarded when the mic slot actually starts. |
| **Dead split** | **1200** | An exact 50/50 has no majority, so everybody who picked gets the full read bonus. |

### End awards

Four awards, four different people — an award is passed down to the next-best candidate rather
than dropped if someone has already won one.

- **The Oracle** — most total read-the-room points, so it naturally goes to whoever called the
  close ones rather than whoever agreed with the crowd most often.
- **Lone Wolf** — most rounds spent in a small minority.
- **The Mouth** — held the mic the longest. Measured in **time**, not turns: with 25 people and
  16 mic slots nobody ever speaks twice, so a count of turns cannot pick a winner.
- **Crowd Splitter** — was on the thin side of the closest splits. In a 13/12 room the 12 are the
  ones keeping it from being a landslide. Distinct from Lone Wolf, which rewards tiny minorities.

## Running it at an event

Put the **host screen** on the projector and leave it alone. Everyone else scans the QR code.

```bash
python serve.py
```

Serves HTTPS on **4255** and HTTP on **4256**. For a real event just use the GitHub Pages URL —
it has a trusted certificate, so no phone has to click through a warning.

`cert.pem` / `key.pem` are gitignored and never committed. To make a local pair:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
```

### Host controls

| | |
|---|---|
| `Space` / `Enter` | advance whatever is on screen |
| `M` | mute all sound |
| `B` | background music on/off |
| `R` | re-spin both reels (spin phase only) |
| Re-spin A / Re-spin B | when the name that came up is not actually in the room |
| +15 seconds | when someone is mid-sentence |
| Done, next | when they finish early |

## Architecture

Static site. No backend, no database, no build step. Identical to Spill the Letters:

- **`js/net.js`** — PeerJS, host-authoritative. The big screen is the peer, phones open data
  connections to it. Peer id is `totrm-<CODE>` so the QR only carries 4 letters. Copied nearly
  verbatim from Spill the Letters; the only change is the prefix, so the two games cannot collide
  on the broker if both are ever open at once.
- **`js/host.js`** — owns *all* state, timers and scoring. Pushes each phone a personalised view.
- **`js/player.js`** — a dumb client. Sends `pick`, renders whatever view arrives.
- **`js/questions.js`** — the question bank, chapters, bot names. Hand-edited.
- **`js/art.js`** — generated image manifest. Do not hand-edit.
- **`js/music.js`** — the bed, synthesised live in Web Audio. Nothing to license, nothing to fetch
  at the venue. Drops to almost nothing during the mic phase so the speaker can be heard.

### Layouts measure themselves

The host laptop could be 1366×768 or 1920×1080 and nothing may clip, so the layouts measure and
fit rather than relying on hand-tuned CSS clamps:

- `fitRoster()` shrinks lobby player cards until 25 names fit.
- `fitLeft()` scales the whole wordmark/QR/code block to its track.
- `fitSplit()` scales the name chips **up as well as down** — six people on a projector should be
  big, twenty-five on a laptop should still all fit.
- `fitMic()` scales the mic stage, which varies a lot between a short name with no chapter and a
  long one with a crest.

### Edge cases that are actually handled

- **Nobody goes twice** until everyone on their side has had a turn, tracked across the whole
  game rather than per round. Verified: 40 rounds, 80 mic slots, 6 players, spread of exactly 1.
- **A side can be empty.** A 25/0 split skips that reel with "Nobody took this side" on screen and
  runs the mic for one side only, rather than hanging.
- **A side can have one person.** The reel is padded with other names so it still looks like a
  machine, and lands on the only candidate.
- **The spun player may have dropped.** Candidates are filtered to reachable players, and if the
  chosen one is gone by the time the mic starts the game re-spins automatically and says so.
- **The host may alt-tab.** `requestAnimationFrame` stops in a background tab, which would leave
  the reels mid-spin forever, so a wall-clock timer lands them regardless.
- **Reconnects** keep name, colour and score — identity is a `localStorage` id, not the socket.
- **Late joins** are allowed at any point. Hard cap 40 players.

## Test hooks

On the host URL:

| | |
|---|---|
| `?bots=25` | add 25 simulated players |
| `?fast` | scale every timer to ~22% |
| `?auto` | start as soon as the bots are in |

Bots vote **and** get spun and put on the mic, so the whole loop is testable without 25 phones.
Their per-round bias is randomised so test games produce genuinely split rounds, lopsided rounds
and occasional wipeouts where one side is empty.

In the console (`SPLIT` is an alias for `TOT`, from the working name):

```js
TOT.state()        // phase, round, split, who got spun, who has spoken, scores
TOT.skip()         // jump past whatever is on screen
TOT.spin()         // re-run the slot machine. TOT.spin("a") for one side
TOT.jumpToEnd()    // straight to the podium
TOT.addBots(10)
```

## The artwork

**Pre-generated at build time and committed.** Nothing is generated in the browser: live
generation would stall the projector for 5–10 seconds per question and would put an API key in a
public static site.

60 images (Classic + Campus), 512×512 JPEG, ~3.3 MB total. One fixed art direction is appended to
every prompt — flat poster illustration, thick linework, gold/crimson/cream on near-black, print
grain, no text, no logos, no recognisable people — so the set reads as one deliberate collection.

```bash
python tools/images.py plan --missing     # what still needs generating, with full prompts
python tools/images.py fetch urls.json    # download, square, resize, rewrite js/art.js
python tools/images.py manifest           # rebuild js/art.js from what is in img/
```

The generation call itself is made by an agent holding the OpenAI Toolbox MCP tools, because those
are agent tools and a plain script cannot call them. `tools/images.py` owns everything either side
of that. Subject lines live in `tools/art_hints.json`; a question with no hint falls back to its
own option label, so hints are a refinement and never a requirement.

**A question with no image is not broken.** It renders as a bold type-only card — the same
crimson/gold treatment, halftone and all. That is a designed state, and it is also what you get if
an image ever fails to load, so the game can never show a broken image at an event.

## Content

62 questions across five toggleable packs. Both options are written to be genuinely defensible: a
question where 24 of 25 pick the same thing is a dead round, and it means whoever gets spun on the
losing side has nothing to say.

| Pack | Count | Illustrated | Reviewed? |
|---|---|---|---|
| Classic | 15 | yes | safe, general |
| Campus | 15 | yes | **written blind — needs a VCU eye** |
| Greek Life | 10 | type-only | **written blind — needs a UGC member** |
| Deep Cuts | 10 | type-only | safe, general |
| Chaos | 12 | type-only | safe, general |

> **Please get a UGC member to read the Greek Life pack and a VCU student to read the Campus pack
> before an event.** Campus names real Richmond and VCU places (Cabell, Shafer, Monroe Park, the
> Compass, Carytown, Scott's Addition, Mama J's, Kuba Kuba, Sugar Shack, the Siegel Center) from
> outside knowledge, not from being there — some pairings may be lopsided in practice, and a
> lopsided pairing is a dead round. Greek Life guesses at chapter culture and is the most likely
> to be slightly off.

There is no profanity filter. The host advancing the phase is the moderation tool.

## Chapter branding

Chapters are represented by their **Greek letters set in the game's display face**. No chapter's
real crest, badge or logo is reproduced, and none is AI-generated. Those are the organisations'
own registered marks. The colours used are this game's palette, not any chapter's official
colours. Same rule as Spill the Letters — if UGC wants their actual artwork in here, it has to
come from them.

Chapters listed: LTA, aKDPhi, KPG, LTP, LAU, APsiL, LUL, SLU, plus "Not in a chapter".

## Not an official UGC product

Built by Cooper Meidinger. Themed to look like it belongs to UGC at VCU, but not affiliated with
or endorsed by the council or any chapter.
