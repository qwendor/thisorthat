/* THIS OR THAT - host (the big screen)
   Host-authoritative: this screen owns all state, timers and scoring.
   Phones only send "pick" and render whatever view they are given.

   Phase machine:  lobby -> intro -> pick -> split -> spin -> mic -> scores
                                       ^-------------------------------|
                   ... -> final

   The spin is the point of the game, so it gets the most care here: no-repeat
   tracking across the whole game, empty and single-person sides, disconnected
   picks, and a host re-spin.                                                  */
(function () {
  "use strict";

  var U = window.UI;
  var params = new URLSearchParams(location.search);
  var FAST = params.has("fast");
  var TS = FAST ? 0.22 : 1;

  var T = {
    intro:   Math.round(2600 * TS),
    pick:    Math.round(24000 * TS),
    split:   Math.round(9500 * TS),
    spinA:   Math.round(2700 * TS),   // first reel decelerates for this long
    spinGap: Math.round(1250 * TS),   // second reel stops this much later
    spinEnd: Math.round(2600 * TS),   // hold on both names before the mic
    mic:     Math.round(30000 * TS),
    scores:  Math.round(10000 * TS),
    grace:   Math.round(1200 * TS)
  };

  /* Scoring.
     read  - full value only when the room was split down the middle. Scaled by
             how close the split was, with a curve so a 96/4 pays almost nothing.
     alone - for being in a small minority. Biggest when you are the only one.
     mic   - flat, for being spun and made to speak. The spin is upside, not a tax. */
  var PTS = { read: 1200, alone: 900, mic: 700 };
  var READ_CURVE = 1.35;
  var ALONE_CAP = 0.30;             // minorities above 30% of the room get nothing

  var G = null;
  var net = null;
  var painted = "";
  var tickT = 0;
  var phaseT = 0;
  var botT = [];
  var reelRAF = [];

  /* ---------------- helpers ---------------- */
  function now() { return Date.now(); }
  function P(pid) { return G.players[pid]; }
  function list() { return G.order.map(P).filter(Boolean); }
  function active() { return list().filter(function (p) { return p.connected || p.bot; }); }
  function ranked() {
    return list().slice().sort(function (a, b) {
      return b.score - a.score || a.joinedAt - b.joinedAt;
    });
  }
  function rankOf(pid) {
    var r = ranked(), i;
    for (i = 0; i < r.length; i++) if (r[i].pid === pid) return i + 1;
    return r.length;
  }
  function stat(pid) {
    return G.stats[pid] || (G.stats[pid] = {
      picked: 0, majority: 0, minority: 0, lone: 0,
      oracle: 0, splitter: 0, mic: 0, micMs: 0
    });
  }
  function clearBots() { botT.forEach(clearTimeout); botT = []; }
  function clearReels() { reelRAF.forEach(cancelAnimationFrame); reelRAF = []; }
  function later(fn, ms) { var id = setTimeout(fn, ms); botT.push(id); return id; }

  /* Just the letters, coloured. Used where a crest would be too small to read. */
  function orgTagHTML(orgId) {
    var o = window.ORG_BY_ID[orgId];
    if (!o) return "";
    return '<span class="org" style="color:' + o.color + '" title="' + U.esc(o.name) + '">' +
      o.letters + '</span>';
  }

  /* A chapter's Greek letters set as a badge. Not anyone's real crest. */
  function crestHTML(orgId, cls) {
    var o = window.ORG_BY_ID[orgId];
    if (!o) return "";
    return '<span class="crest ' + (cls || "") + '" style="--cc:' + o.color + '" title="' + U.esc(o.name) + '">' +
      '<span class="lt">' + o.letters + '</span>' +
      '<span class="ab">' + U.esc(o.id) + '</span></span>';
  }

  /* Art is pre-generated and baked into the repo (see tools/images.py). If a
     question has none, the option renders as a bold type card instead, which is
     a designed state. Nothing here ever requests an image that is not listed. */
  function artURL(q, side) {
    if (!q || !window.ART) return null;
    var k = q.id + "-" + side;
    return window.ART[k] ? "img/" + k + ".jpg" : null;
  }

  /* ---------------- game setup ---------------- */
  function newGame() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("tot.setup") || "{}"); } catch (e) {}
    G = {
      phase: "lobby",
      round: 0,
      totalRounds: saved.rounds || 8,
      packs: saved.packs || { classic: true, campus: true, greek: true, deep: true, chaos: true },
      music: saved.music !== false,
      players: {}, order: [],
      deck: [], q: null,
      picks: {}, split: null,
      spin: null, micQueue: [], micIdx: -1, micPid: null, micSide: null, micStart: 0,
      spoken: {},
      stats: {}, gains: {},
      deadline: 0, duration: 0,
      seq: 0, sub: ""
    };
  }

  function saveSetup() {
    try {
      localStorage.setItem("tot.setup",
        JSON.stringify({ rounds: G.totalRounds, packs: G.packs, music: G.music }));
    } catch (e) {}
  }

  function buildDeck() {
    var pool = window.QUESTIONS.filter(function (x) { return G.packs[x.p]; });
    if (!pool.length) pool = window.QUESTIONS.slice();
    G.deck = U.shuffle(pool.slice());
  }

  function drawQuestion() {
    if (!G.deck.length) buildDeck();
    return G.deck.pop();
  }

  /* ---------------- joining ---------------- */
  function uniqueName(name, pid) {
    var base = U.clean(name, 18) || "Player";
    var taken = {}, i;
    G.order.forEach(function (id) {
      if (id !== pid && G.players[id]) taken[G.players[id].name.toLowerCase()] = 1;
    });
    if (!taken[base.toLowerCase()]) return base;
    for (i = 2; i < 60; i++) if (!taken[(base + " " + i).toLowerCase()]) return base + " " + i;
    return base + " " + Math.floor(Math.random() * 900 + 100);
  }

  function onJoin(msg) {
    var pid = String(msg.pid || "").slice(0, 40);
    var existing = pid && G.players[pid];

    if (existing) {                       // reconnect: keep score and identity
      existing.connected = true;
      existing.name = uniqueName(msg.name || existing.name, pid);
      existing.color = msg.color || existing.color;
      existing.org = U.clean(msg.org, 10);
      schedulePush();
      repaintSoft();
      return pid;
    }

    if (G.order.length >= 40) return null;
    if (!pid) return null;

    var used = {};
    list().forEach(function (p) { used[p.color] = 1; });
    var free = U.COLORS.filter(function (c) { return !used[c]; });
    var color = msg.color && !used[msg.color] ? msg.color
      : (free.length ? free[(Math.random() * free.length) | 0]
        : U.COLORS[G.order.length % U.COLORS.length]);

    G.players[pid] = {
      pid: pid,
      name: uniqueName(msg.name, pid),
      org: U.clean(msg.org, 10),
      color: color,
      score: 0,
      connected: true,
      bot: false,
      joinedAt: now()
    };
    G.order.push(pid);
    stat(pid);
    U.sfx.join();
    schedulePush();
    repaintSoft();
    return pid;
  }

  function onLeave(pid) {
    var p = P(pid);
    if (!p) return;
    p.connected = false;
    repaintSoft();
    // If the person on the mic just dropped, do not sit on a dead timer.
    if (G.phase === "mic" && G.micPid === pid) { nextMic(); return; }
    checkAutoAdvance();
  }

  function onMsg(pid, msg) {
    var p = P(pid);
    if (!p || !msg) return;

    if (msg.t === "pick" && G.phase === "pick") {
      if (msg.side !== "a" && msg.side !== "b") return;
      var first = !G.picks[pid];
      G.picks[pid] = msg.side;
      if (first) stat(pid).picked++;
      send(pid, viewFor(pid));
      repaintSoft();
      checkAutoAdvance();
      return;
    }

    if (msg.t === "rename") {
      p.name = uniqueName(msg.name, pid);
      p.color = msg.color || p.color;
      p.org = U.clean(msg.org, 10);
      schedulePush();
      repaintSoft();
    }
  }

  /* ---------------- outbound views ---------------- */
  function send(pid, view) {
    var p = P(pid);
    if (!p || p.bot || !net) return;
    net.send(pid, view);
  }

  var pushT = 0;
  function schedulePush() {
    clearTimeout(pushT);
    pushT = setTimeout(pushAll, 40);
  }
  function pushAll() {
    G.order.forEach(function (pid) { send(pid, viewFor(pid)); });
  }
  /* Change what the phones show without repainting the big screen. The host
     paint is keyed on phase+seq only, so bumping "sub" never interrupts an
     animation that is already running up there. */
  function bump(sub) {
    G.sub = sub || "";
    pushAll();
  }

  function msLeft() { return Math.max(0, G.deadline - now()); }

  function viewFor(pid) {
    var p = P(pid);
    if (!p) return { t: "view", phase: "gone" };
    var base = {
      t: "view",
      phase: G.phase,
      seq: G.seq,
      sub: G.sub,
      round: G.round,
      totalRounds: G.totalRounds,
      you: { name: p.name, color: p.color, org: p.org, score: p.score, rank: rankOf(pid) },
      of: G.order.length
    };

    if (G.phase === "lobby") { base.count = G.order.length; return base; }
    if (G.phase === "intro") return base;

    if (G.phase === "pick") {
      base.a = G.q ? G.q.a : "";
      base.b = G.q ? G.q.b : "";
      base.qsub = G.q ? (G.q.sub || "") : "";
      base.artA = artURL(G.q, "a");
      base.artB = artURL(G.q, "b");
      base.picked = G.picks[pid] || null;
      base.ms = msLeft();
      base.total = G.duration;
      return base;
    }

    if (G.phase === "split" && G.split) {
      var s = G.split;
      base.a = s.aLabel; base.b = s.bLabel;
      base.countA = s.a; base.countB = s.b;
      base.pctA = s.pctA; base.pctB = s.pctB;
      base.mine = G.picks[pid] || null;
      base.majSide = s.majSide;
      base.gained = G.gains[pid] || 0;
      base.why = s.why[pid] || "";
      return base;
    }

    if (G.phase === "spin") {
      base.a = G.q ? G.q.a : ""; base.b = G.q ? G.q.b : "";
      base.mine = G.picks[pid] || null;
      base.landed = G.sub === "landed";
      if (base.landed && G.spin) {
        base.spunA = G.spin.a.pid ? P(G.spin.a.pid).name : null;
        base.spunB = G.spin.b.pid ? P(G.spin.b.pid).name : null;
        base.youSpun = (G.spin.a.pid === pid) || (G.spin.b.pid === pid);
      }
      return base;
    }

    if (G.phase === "mic") {
      var sp = G.micPid ? P(G.micPid) : null;
      base.speaker = sp ? sp.name : "";
      base.side = G.micSide;
      base.option = G.micSide === "a" ? (G.q ? G.q.a : "") : (G.q ? G.q.b : "");
      base.isYou = G.micPid === pid;
      base.ms = msLeft();
      base.total = G.duration;
      base.gained = base.isYou ? PTS.mic : 0;
      return base;
    }

    if (G.phase === "scores") { base.gained = G.gains[pid] || 0; return base; }

    if (G.phase === "final") {
      base.award = (G.awards || []).filter(function (a) { return a.pid === pid; })
        .map(function (a) { return a.title; })[0] || null;
      base.winner = G.winnerName || "";
      return base;
    }
    return base;
  }

  /* ---------------- phase machine ---------------- */
  function setPhase(name, dur) {
    clearTimeout(phaseT);
    clearBots();
    clearReels();
    G.phase = name;
    G.seq++;
    G.sub = "";
    if (window.MUSIC) MUSIC.setPhase(name);
    G.duration = dur || 0;
    G.deadline = dur ? now() + dur : 0;
    painted = "";
    paint();
    pushAll();
  }

  function startGame() {
    if (active().length < 2) { U.toast("Need at least 2 players", true); return; }
    buildDeck();
    G.round = 0;
    G.stats = {};
    G.spoken = {};
    list().forEach(function (p) { p.score = 0; stat(p.pid); });
    U.sfx.start();
    nextRound();
  }

  function nextRound() {
    if (G.round >= G.totalRounds) { finish(); return; }
    G.round++;
    G.gains = {};
    U.sfx.round();
    setPhase("intro", T.intro);
    phaseT = setTimeout(beginPick, T.intro);
  }

  function beginPick() {
    G.q = drawQuestion();
    G.picks = {};
    G.split = null;
    G.spin = null;
    setPhase("pick", T.pick);
    phaseT = setTimeout(endPick, T.pick);
    scheduleBotPicks();
  }

  /* ---------------- scoring ---------------- */
  function endPick() {
    clearTimeout(phaseT);
    clearBots();
    scoreRound();
    U.sfx.slide();
    setPhase("split", T.split);
    phaseT = setTimeout(beginSpin, T.split);
  }

  function scoreRound() {
    var a = 0, b = 0, why = {};
    Object.keys(G.picks).forEach(function (pid) {
      if (!P(pid)) return;
      if (G.picks[pid] === "a") a++; else b++;
    });
    var total = a + b;
    var maj = Math.max(a, b);
    var majFrac = total ? maj / total : 0;
    var majSide = a > b ? "a" : b > a ? "b" : null;      // null = dead even
    // closeness: 1 when the room split 50/50, 0 when it was unanimous
    var close = total ? Math.max(0, Math.min(1, 1 - (majFrac - 0.5) / 0.5)) : 0;
    var readPts = Math.round(PTS.read * Math.pow(close, READ_CURVE));

    Object.keys(G.picks).forEach(function (pid) {
      if (!P(pid)) return;
      var side = G.picks[pid];
      var mine = side === "a" ? a : b;
      var frac = total ? mine / total : 0;
      var st = stat(pid);
      var got = 0, note = [];

      if (majSide === null) {                 // dead even: everybody read it
        got += readPts;
        st.oracle += readPts;
        st.majority++;
        if (readPts) note.push("Dead split +" + readPts);
      } else if (side === majSide) {
        got += readPts;
        st.oracle += readPts;
        st.majority++;
        if (readPts) note.push("Read the room +" + readPts);
      } else {
        st.minority++;
        st.splitter += close;                 // being the 12 in a 13/12
      }

      if (frac > 0 && frac < ALONE_CAP && total >= 3) {
        var alone = Math.round(PTS.alone * (1 - frac / ALONE_CAP));
        if (alone > 0) {
          got += alone;
          st.lone++;
          note.push("Stood alone +" + alone);
        }
      }

      if (got) award(pid, got);
      why[pid] = note.join(" · ");
    });

    G.split = {
      a: a, b: b, total: total,
      aLabel: G.q ? G.q.a : "", bLabel: G.q ? G.q.b : "",
      pctA: total ? Math.round((a / total) * 100) : 0,
      pctB: total ? 100 - Math.round((a / total) * 100) : 0,
      majSide: majSide, close: close, readPts: readPts, why: why
    };
  }

  function award(pid, pts) {
    var p = P(pid);
    if (!p) return;
    p.score += pts;
    G.gains[pid] = (G.gains[pid] || 0) + pts;
  }

  /* ---------------- the spin ---------------- */
  /* Candidates: on this side, still reachable, and with the fewest turns so far
     across the WHOLE game. That is the no-repeat rule: nobody goes twice until
     everyone on their side has gone once. */
  function candidates(side) {
    var pool = list().filter(function (p) {
      return (p.connected || p.bot) && G.picks[p.pid] === side;
    });
    if (!pool.length) return [];
    var min = Infinity;
    pool.forEach(function (p) { min = Math.min(min, G.spoken[p.pid] || 0); });
    return pool.filter(function (p) { return (G.spoken[p.pid] || 0) === min; });
  }

  function pickSpeaker(side, avoidPid) {
    var tier = candidates(side);
    if (!tier.length) return null;
    if (avoidPid && tier.length > 1) {
      tier = tier.filter(function (p) { return p.pid !== avoidPid; });
    }
    return U.shuffle(tier.slice())[0].pid;
  }

  function beginSpin() {
    clearTimeout(phaseT);
    if (!G.split || G.split.total === 0) {   // nobody picked at all
      showScores();
      return;
    }
    G.spin = {
      a: { pid: pickSpeaker("a"), locked: false },
      b: { pid: pickSpeaker("b"), locked: false }
    };
    setPhase("spin", 0);
  }

  /* Fired by paintSpin once both reels have stopped. */
  function spinLanded() {
    U.sfx.fanfare();
    bump("landed");
    clearTimeout(phaseT);
    phaseT = setTimeout(beginMicSequence, T.spinEnd);
  }

  function respin(side) {
    if (G.phase !== "spin" || !G.spin) return;
    var next = pickSpeaker(side, G.spin[side].pid);
    if (!next) { U.toast("Nobody else on that side", true); return; }
    G.spin[side].pid = next;
    G.spin[side].locked = false;
    clearTimeout(phaseT);
    G.sub = "";
    painted = "";                       // force a full repaint of the spin stage
    paint();
    pushAll();
  }

  /* ---------------- the mic ---------------- */
  function beginMicSequence() {
    clearTimeout(phaseT);
    G.micQueue = ["a", "b"].filter(function (s) { return G.spin && G.spin[s].pid; });
    G.micIdx = -1;
    nextMic();
  }

  /* Bank however long the current speaker actually held the mic. With 25 people
     and 16 mic slots nobody ever speaks twice, so a count of turns cannot pick
     a winner for The Mouth. Time held can, and it rewards the person the host
     kept giving +15 seconds to, which is what "spoke the most" means anyway. */
  function closeMic() {
    if (G.micPid && G.micStart) stat(G.micPid).micMs += Math.max(0, now() - G.micStart);
    G.micStart = 0;
  }

  function nextMic() {
    clearTimeout(phaseT);
    closeMic();
    G.micIdx++;
    if (G.micIdx >= G.micQueue.length) { showScores(); return; }

    var side = G.micQueue[G.micIdx];
    var pid = G.spin[side].pid;
    var p = pid && P(pid);

    /* Their phone cannot show YOU'RE UP if they are not there. Re-spin rather
       than making the room wait on someone who left. */
    if (!p || !(p.connected || p.bot)) {
      var next = pickSpeaker(side, pid);
      if (!next) {
        U.toast("Nobody left on side " + side.toUpperCase() + ", skipping");
        nextMic();
        return;
      }
      G.spin[side].pid = next;
      pid = next;
      p = P(pid);
      U.toast(p.name + " is up instead (the first pick dropped)");
    }

    G.micSide = side;
    G.micPid = pid;
    G.micStart = now();
    G.spoken[pid] = (G.spoken[pid] || 0) + 1;
    stat(pid).mic++;
    award(pid, PTS.mic);
    U.sfx.micOn();
    setPhase("mic", T.mic);
    phaseT = setTimeout(function () { U.sfx.micOff(); nextMic(); }, T.mic);
  }

  function addMicTime(ms) {
    if (G.phase !== "mic") return;
    clearTimeout(phaseT);
    G.deadline += ms;
    G.duration += ms;
    phaseT = setTimeout(function () { U.sfx.micOff(); nextMic(); }, msLeft());
    pushAll();
  }

  function showScores() {
    G.micPid = null;
    setPhase("scores", T.scores);
    phaseT = setTimeout(nextRound, T.scores);
  }

  function finish() {
    closeMic();                       // in case the host jumped straight to the end
    G.micPid = null;
    G.awards = computeAwards();
    var top = ranked()[0];
    G.winnerName = top ? top.name : "";
    setPhase("final", 0);
    U.sfx.win();
    U.confetti(7000);
  }

  function computeAwards() {
    var out = [], taken = {};
    var all = list().filter(function (p) { return stat(p.pid).picked > 0 || p.score > 0; });
    if (!all.length) return out;

    /* One award per person, but an award is passed down to the next best
       candidate rather than dropped. Four names on the board beats two. */
    function best(title, desc, key) {
      var pool = all.filter(function (p) {
        return !taken[p.pid] && stat(p.pid)[key] > 0;
      }).sort(function (a, b) {
        return (stat(b.pid)[key] - stat(a.pid)[key]) || (b.score - a.score);
      });
      if (!pool.length) return;
      taken[pool[0].pid] = 1;
      out.push({ pid: pool[0].pid, title: title, desc: desc, name: pool[0].name });
    }

    best("The Oracle", "best read on the close ones", "oracle");
    best("Lone Wolf", "most picks against the room", "lone");
    best("The Mouth", "held the mic the longest", "micMs");
    best("Crowd Splitter", "kept the room from agreeing", "splitter");
    return out;
  }

  /* ---------------- auto-advance ---------------- */
  var graceT = 0;
  function checkAutoAdvance() {
    clearTimeout(graceT);
    if (G.phase !== "pick") return;
    var act = active();
    if (act.length && act.every(function (p) { return !!G.picks[p.pid]; })) {
      graceT = setTimeout(function () {
        if (G.phase === "pick") endPick();
      }, T.grace);
    }
  }

  /* ---------------- test bots ---------------- */
  function addBots(n) {
    var names = window.BOT_NAMES;
    for (var i = 0; i < n; i++) {
      var pid = "bot-" + Math.random().toString(36).slice(2, 9);
      var used = {};
      list().forEach(function (p) { used[p.color] = 1; });
      var free = U.COLORS.filter(function (c) { return !used[c]; });
      G.players[pid] = {
        pid: pid,
        name: uniqueName(names[(G.order.length) % names.length], pid),
        org: window.ORGS[(Math.random() * (window.ORGS.length - 1)) | 0].id,
        color: free.length ? free[0] : U.COLORS[G.order.length % U.COLORS.length],
        score: 0, connected: false, bot: true, joinedAt: now()
      };
      G.order.push(pid);
      stat(pid);
    }
    repaintSoft();
  }

  /* Bots pick with a per-round bias, so test games produce the whole range of
     splits: near-even rounds, lopsided rounds, and now and then a wipeout where
     one side is empty. All three have to survive the spin. */
  function scheduleBotPicks() {
    var r = Math.random();
    var bias = r < 0.10 ? (Math.random() < 0.5 ? 0.02 : 0.98)   // wipeout
      : r < 0.25 ? (Math.random() < 0.5 ? 0.15 : 0.85)          // lopsided
        : 0.32 + Math.random() * 0.36;                          // genuinely split
    list().filter(function (p) { return p.bot; }).forEach(function (p) {
      later(function () {
        if (G.phase !== "pick" || G.picks[p.pid]) return;
        G.picks[p.pid] = Math.random() < bias ? "a" : "b";
        stat(p.pid).picked++;
        repaintSoft();
        checkAutoAdvance();
      }, (700 + Math.random() * Math.min(7000, T.pick * 0.55)) * (FAST ? 0.3 : 1));
    });
  }

  /* ================================================================
     RENDER
     ================================================================ */
  function joinURL() {
    var base = location.origin + location.pathname.replace(/index\.html?$/i, "");
    return base + "#" + (G.code || "");
  }

  function shell(body, bar) {
    var players = G.order.length;
    return '' +
      '<div class="host">' +
        '<div class="host-top">' +
          '<div class="host-brand">' +
            '<div class="seal"><span>UGC</span></div>' +
            '<div class="name">This or<em>That</em></div>' +
          '</div>' +
          '<div class="host-meta">' +
            (G.phase !== "lobby" && G.phase !== "final"
              ? '<div class="meta-block"><div class="v">' + G.round + '/' + G.totalRounds + '</div><div class="k">Round</div></div>'
              : '') +
            '<div class="meta-block"><div class="v">' + players + '</div><div class="k">Players</div></div>' +
            (G.phase !== "lobby"
              ? '<div class="meta-block"><div class="v" style="font-size:22px">' + U.esc(G.code || "") + '</div><div class="k">Room</div></div>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="host-body">' + body + '</div>' +
        '<div class="hostbar">' + (bar || "") + '</div>' +
      '</div>';
  }

  function paint() {
    if (painted === G.phase + ":" + G.seq) return;
    painted = G.phase + ":" + G.seq;
    var fn = ({
      lobby: paintLobby, intro: paintIntro, pick: paintPick,
      split: paintSplit, spin: paintSpin, mic: paintMic,
      scores: paintScores, final: paintFinal
    })[G.phase];
    if (fn) fn();
  }

  /* Light refresh that must not restart entrance animations. */
  function repaintSoft() {
    if (G.phase === "lobby") return updateLobby();
    if (G.phase === "pick") return updatePick();
  }

  /* ---------------- lobby ---------------- */
  function pcardHTML(p) {
    return '<div class="pcard' + (p.connected || p.bot ? "" : " off") + '" data-pid="' + U.esc(p.pid) + '">' +
      '<span class="dot" style="background:' + U.esc(p.color) + '"></span>' +
      '<span class="nm">' + U.esc(p.name) + '</span>' +
      (p.org ? orgTagHTML(p.org) : '') +
      '</div>';
  }

  function paintLobby() {
    var packChips = window.PACKS.map(function (k) {
      return '<button class="chip" data-pack="' + k.id + '" aria-pressed="' + (!!G.packs[k.id]) + '">' + U.esc(k.label) + '</button>';
    }).join("");
    var roundChips = [5, 8, 12].map(function (n) {
      return '<button class="chip" data-rounds="' + n + '" aria-pressed="' + (G.totalRounds === n) + '">' + n + ' rounds</button>';
    }).join("");

    U.render(shell(
      '<div class="lobby">' +
        '<div class="lobby-left"><div class="ll-inner">' +
          '<div class="wordmark"><div class="l1">This</div><div class="l2">Or</div><div class="l3">That</div>' +
            '<div class="ugc-tag">Unified Greek Council &middot; VCU</div></div>' +
          '<div class="joinbox">' +
            '<div class="qrwrap" id="qr"></div>' +
            '<div class="joininfo">' +
              '<div><div class="lbl">Scan, or go to</div><div class="url">' + U.esc(joinURL().replace(/^https?:\/\//, "")) + '</div></div>' +
              '<div><div class="lbl">Room code</div><div class="codebig" id="codebig">' + U.esc(G.code || "....") + '</div></div>' +
            '</div>' +
          '</div>' +
          '<ol class="howto">' +
            '<li><b>1</b> Scan the code and put your name in</li>' +
            '<li><b>2</b> Two options come up. Pick a side</li>' +
            '<li><b>3</b> One person per side stands up and defends it</li>' +
          '</ol>' +
        '</div></div>' +
        '<div class="lobby-right">' +
          '<div class="roster-head"><div class="n"><span id="pcount">' + G.order.length + '</span> in</div>' +
            '<div class="kicker dim">Waiting for the room</div></div>' +
          '<div class="roster" id="roster">' + list().map(pcardHTML).join("") + '</div>' +
          '<div class="setup">' +
            '<div class="setup-row"><span class="lbl">Packs</span>' + packChips + '</div>' +
            '<div class="setup-row"><span class="lbl">Length</span>' + roundChips + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lobby-foot">' +
          '<div class="stripe-band"></div>' +
          '<div class="chapter-strip">' +
            window.ORGS.filter(function (o) { return o.id !== "Guest"; })
              .map(function (o) { return crestHTML(o.id); }).join("") +
          '</div>' +
        '</div>' +
      '</div>',
      '<button class="btn" id="startBtn"' + (active().length < 2 ? " disabled" : "") + '>Start the game</button>' +
      '<button class="btn ghost" id="muteBtn">' + (U.sfx.isMuted() ? "Sound off" : "Sound on") + '</button>' +
      '<button class="btn ghost" id="musicBtn">' + (G.music ? "Music on" : "Music off") + '</button>' +
      '<span class="hint">Space to start</span>'
    ));

    drawQR();
    U.on("[data-pack]", "click", function (e) {
      var id = e.currentTarget.getAttribute("data-pack");
      var onCount = window.PACKS.filter(function (k) { return G.packs[k.id]; }).length;
      if (G.packs[id] && onCount <= 1) { U.toast("Keep at least one pack on"); return; }
      G.packs[id] = !G.packs[id];
      e.currentTarget.setAttribute("aria-pressed", String(!!G.packs[id]));
      saveSetup();
    });
    U.on("[data-rounds]", "click", function (e) {
      G.totalRounds = parseInt(e.currentTarget.getAttribute("data-rounds"), 10);
      U.qa("[data-rounds]").forEach(function (n) {
        n.setAttribute("aria-pressed", String(parseInt(n.getAttribute("data-rounds"), 10) === G.totalRounds));
      });
      saveSetup();
    });
    U.on("#startBtn", "click", startGame);
    U.on("#muteBtn", "click", function (e) {
      U.sfx.setMuted(!U.sfx.isMuted());
      e.currentTarget.textContent = U.sfx.isMuted() ? "Sound off" : "Sound on";
    });
    U.on("#musicBtn", "click", function (e) {
      toggleMusic();
      e.currentTarget.textContent = G.music ? "Music on" : "Music off";
    });
    refitLobbySoon();
  }

  /* The left column carries the wordmark, QR, code and explainer. Rather than
     hand-tuning every clamp for every projector, scale the block to its track. */
  function fitLeft() {
    U.fitInto(U.q(".lobby-left"), U.q(".ll-inner"), 0.4);
  }

  /* Shrink the player cards until the whole roster fits. Everyone should be
     able to find their own name in the lobby, whether that is 6 people or 30. */
  var PC_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.54];
  function fitRoster() {
    var r = U.q("#roster");
    if (!r || !r.clientHeight) return;
    for (var i = 0; i < PC_STEPS.length; i++) {
      r.style.setProperty("--pc", PC_STEPS[i]);
      if (r.scrollHeight <= r.clientHeight + 1) break;
    }
  }

  /* Refit directly and again after layout settles. Deliberately not
     requestAnimationFrame only: that stops firing in a backgrounded tab, and a
     host screen that gets alt-tabbed away and back would come back mis-sized. */
  function refitLobby() { fitRoster(); fitLeft(); }
  function refitLobbySoon() {
    refitLobby();
    setTimeout(refitLobby, 60);
    setTimeout(refitLobby, 300);
  }

  function updateLobby() {
    var roster = U.q("#roster");
    if (!roster) return;
    var have = {};
    U.qa(".pcard", roster).forEach(function (n) { have[n.getAttribute("data-pid")] = n; });
    list().forEach(function (p) {
      if (have[p.pid]) {
        have[p.pid].classList.toggle("off", !(p.connected || p.bot));
        var nm = have[p.pid].querySelector(".nm");
        if (nm && nm.textContent !== p.name) nm.textContent = p.name;
        delete have[p.pid];
      } else {
        roster.insertAdjacentHTML("beforeend", pcardHTML(p));
      }
    });
    Object.keys(have).forEach(function (pid) { have[pid].remove(); });
    var c = U.q("#pcount"); if (c) c.textContent = String(G.order.length);
    var mb = U.qa(".meta-block .v")[0];
    if (mb) mb.textContent = String(G.order.length);
    var sb = U.q("#startBtn"); if (sb) sb.disabled = active().length < 2;
    var cb = U.q("#codebig"); if (cb && G.code) cb.textContent = G.code;
    fitRoster();
  }

  function paintIntro() {
    U.render(shell(
      '<div class="slam"><div class="r">Round <em>' + G.round + '</em></div>' +
      '<div class="sub">of ' + G.totalRounds + '</div></div>', ""
    ));
  }

  /* ---------------- pick ---------------- */
  /* Two states, one markup. With art: the image fills the tile and the label
     sits under it. Without art (or if the image fails to load): .noart hides
     that label and the type card underneath becomes the artwork. The onerror
     flips the tile into .noart too, so a half-deployed img/ folder degrades
     into the type treatment instead of showing a broken image at an event. */
  function optHTML(side, label) {
    var url = artURL(G.q, side);
    var sz = U.optClass(label);
    return '<div class="opt ' + side + (url ? "" : " noart") + '">' +
      '<div class="opt-key">' + side.toUpperCase() + '</div>' +
      '<div class="opt-art">' +
        '<div class="opt-type ' + sz + '">' + U.esc(label) + '</div>' +
        (url ? '<img src="' + U.esc(url) + '" alt="" onload="this.classList.add(\'on\')" ' +
          'onerror="this.parentNode.parentNode.classList.add(\'noart\');this.remove()">' : '') +
      '</div>' +
      '<div class="opt-label ' + sz + '">' + U.esc(label) + '</div>' +
      '</div>';
  }

  function paintPick() {
    var q = G.q;
    U.render(shell(
      '<div class="qstage">' +
        '<div class="qsub">' + U.esc(q && q.sub ? q.sub : "Pick a side") + '</div>' +
        '<div class="opts">' +
          optHTML("a", q ? q.a : "") +
          '<div class="vs">OR</div>' +
          optHTML("b", q ? q.b : "") +
        '</div>' +
        '<div class="qmeter">' +
          U.ringHTML("ring") +
          '<div><div class="count-line" id="cline"><b>0</b> of ' + active().length + ' in</div>' +
          '<div class="progress-dots" id="dots">' + dotsHTML() + '</div></div>' +
        '</div>' +
      '</div>',
      '<button class="btn ghost" id="skipBtn">Lock it in</button><span class="hint">Space to close voting</span>'
    ));
    U.on("#skipBtn", "click", endPick);
    updatePick();
  }

  function dotsHTML() {
    return active().map(function (p) {
      return '<i data-pid="' + U.esc(p.pid) + '"></i>';
    }).join("");
  }

  /* The dots take the player's own colour, never their side's. Showing the
     split while people are still picking would ruin the reveal. */
  function updatePick() {
    var n = 0, act = active();
    act.forEach(function (p) { if (G.picks[p.pid]) n++; });
    var cl = U.q("#cline");
    if (cl) cl.innerHTML = "<b>" + n + "</b> of " + act.length + " in";
    var dots = U.q("#dots");
    if (!dots) return;
    var have = {};
    U.qa("i", dots).forEach(function (i) { have[i.getAttribute("data-pid")] = i; });
    act.forEach(function (p) {
      var el = have[p.pid];
      if (!el) {
        dots.insertAdjacentHTML("beforeend", '<i data-pid="' + U.esc(p.pid) + '"></i>');
        el = dots.lastElementChild;
      }
      var got = !!G.picks[p.pid];
      el.classList.toggle("in", got);
      el.style.background = got ? p.color : "";
      delete have[p.pid];
    });
    Object.keys(have).forEach(function (pid) { have[pid].remove(); });
  }

  /* ---------------- split ---------------- */
  function sideMembers(side) {
    return list().filter(function (p) { return G.picks[p.pid] === side; });
  }

  function nchipHTML(p) {
    return '<span class="nchip"><i class="dot" style="background:' + U.esc(p.color) + '"></i>' +
      '<span class="nm">' + U.esc(p.name) + '</span></span>';
  }

  function paintSplit() {
    var s = G.split;
    var A = sideMembers("a"), B = sideMembers("b");
    var note = s.total === 0 ? "Nobody picked"
      : s.majSide === null ? "Dead split. Everybody read the room."
        : s.close > 0.8 ? "That was close. Big points."
          : s.close < 0.2 ? "Landslide. Barely worth anything."
            : "";

    function col(side, people) {
      return '<div class="scol ' + side + '"><div class="scol-in" id="col-' + side + '">' +
        (people.length ? U.shuffle(people.slice()).map(function (p, i) {
          return nchipHTML(p).replace('class="nchip"',
            'class="nchip" style="animation-delay:' + Math.min(i * 0.035, 1.1) + 's"');
        }).join("") : '<span class="empty">Nobody</span>') +
        '</div></div>';
    }

    U.render(shell(
      '<div class="splitwrap">' +
        '<div class="split-heads">' +
          '<div class="shead a"><span class="k">A</span><span class="t">' + U.esc(s.aLabel) + '</span></div>' +
          '<div class="shead b"><span class="k">B</span><span class="t">' + U.esc(s.bLabel) + '</span></div>' +
        '</div>' +
        '<div class="splitbar" id="sbar">' +
          '<div class="seg a' + (s.a ? "" : " zero") + '" style="width:50%"><span class="pct">' + s.pctA + '%</span></div>' +
          '<div class="seg b' + (s.b ? "" : " zero") + '" style="width:50%"><span class="pct">' + s.pctB + '%</span></div>' +
        '</div>' +
        '<div class="split-cols">' + col("a", A) + col("b", B) + '</div>' +
        (note ? '<div class="split-note' + (s.close < 0.2 ? " dead" : "") + '">' + U.esc(note) + '</div>' : '') +
      '</div>',
      '<button class="btn ghost" id="nextBtn">Spin it</button><span class="hint">Space to spin</span>'
    ));
    U.on("#nextBtn", "click", function () { clearTimeout(phaseT); beginSpin(); });

    // Both segments start at 50% and slide to the truth. The CSS transition on
    // .seg does the work; we just have to change the widths after a frame.
    // Belt and braces on the trigger: rAF gives the nicest timing, the timeout
    // still sets the real widths if the tab was backgrounded and rAF is frozen.
    var bar = U.q("#sbar");
    function setWidths() {
      var segA = U.q(".seg.a"), segB = U.q(".seg.b");
      if (segA) segA.style.width = s.pctA + "%";
      if (segB) segB.style.width = s.pctB + "%";
    }
    requestAnimationFrame(function () { requestAnimationFrame(setWidths); });
    setTimeout(setWidths, 60);
    setTimeout(function () {
      if (G.phase !== "split") return;
      if (bar) bar.classList.add("landed");
      U.sfx.splitHit();
    }, Math.round(1350 * TS));

    fitSplitSoon();
  }

  /* Largest first, so this grows the name chips as well as shrinking them.
     Six people on a 1080p projector should be big; twenty-five on a 1366x768
     laptop should still all fit. One measured pass covers both. */
  var NC_STEPS = [2, 1.75, 1.5, 1.3, 1.15, 1, 0.9, 0.8, 0.72, 0.64, 0.56, 0.5];
  function fitSplit() {
    ["a", "b"].forEach(function (side) {
      var outer = U.q(".scol." + side), inner = U.q("#col-" + side);
      if (!outer || !inner || !outer.clientHeight) return;
      for (var i = 0; i < NC_STEPS.length; i++) {
        inner.style.setProperty("--nc", NC_STEPS[i]);
        if (inner.offsetHeight <= outer.clientHeight + 1) break;
      }
    });
  }
  function fitSplitSoon() { fitSplit(); setTimeout(fitSplit, 80); setTimeout(fitSplit, 400); }

  /* ---------------- spin ---------------- */
  /* Reel cells are mostly people from that side, padded with the rest of the
     room so a side of one still looks like a machine full of names. Only the
     last cell matters: that is where it lands. */
  function reelCells(side, winnerPid, count) {
    var mine = sideMembers(side);
    var all = list();
    var out = [];
    for (var i = 0; i < count - 1; i++) {
      var pool = (mine.length && Math.random() < 0.72) ? mine : all;
      out.push(pool[(Math.random() * pool.length) | 0]);
    }
    out.push(P(winnerPid));
    return out.filter(Boolean);
  }

  function paintSpin() {
    var q = G.q;
    var spin = G.spin || { a: {}, b: {} };

    function box(side, label) {
      var pid = spin[side].pid;
      var n = sideMembers(side).length;
      var body;
      if (!pid) {
        body = '<div class="reel-skip">Nobody<br>took this side</div>';
      } else {
        body = '<div class="reelstrip" id="strip-' + side + '"></div>' +
          '<div class="reel-slot" id="slot-' + side + '"></div>';
      }
      return '<div class="reelbox ' + side + (pid ? "" : " skip") + '" id="box-' + side + '">' +
        '<div class="reel-head"><span class="k">' + side.toUpperCase() + '</span>' +
          '<span class="t">' + U.esc(label) + '</span>' +
          '<span class="n">' + n + ' ' + (n === 1 ? "person" : "people") + '</span></div>' +
        '<div class="reelwin">' + body + '</div>' +
        '</div>';
    }

    U.render(shell(
      '<div class="spinwrap">' +
        '<div class="kicker">Who is defending it?</div>' +
        '<div class="reels">' + box("a", q ? q.a : "") + box("b", q ? q.b : "") + '</div>' +
      '</div>',
      '<button class="btn ghost" id="reA">Re-spin A</button>' +
      '<button class="btn ghost" id="reB">Re-spin B</button>' +
      '<button class="btn ghost" id="nextBtn">Skip to the mic</button>' +
      '<span class="hint">Space to skip</span>'
    ));
    U.on("#reA", "click", function () { respin("a"); });
    U.on("#reB", "click", function () { respin("b"); });
    U.on("#nextBtn", "click", function () { clearTimeout(phaseT); beginMicSequence(); });

    var pending = 0;
    ["a", "b"].forEach(function (side, i) {
      if (!spin[side].pid) { spin[side].locked = true; return; }
      pending++;
      runReel(side, spin[side].pid, i === 0 ? T.spinA : T.spinA + T.spinGap, function () {
        spin[side].locked = true;
        pending--;
        if (pending === 0 && G.phase === "spin") spinLanded();
      });
    });
    if (pending === 0) {
      // Both sides empty. Should not happen (total>0 was checked) but never hang.
      clearTimeout(phaseT);
      phaseT = setTimeout(beginMicSequence, Math.round(900 * TS));
    }
  }

  function runReel(side, winnerPid, dur, done) {
    var win = U.q("#box-" + side + " .reelwin");
    var strip = U.q("#strip-" + side);
    var slot = U.q("#slot-" + side);
    if (!win || !strip) { done(); return; }

    var h = win.clientHeight || 240;
    var cellH = Math.max(30, Math.round(h / 3));
    var count = 26 + ((Math.random() * 6) | 0);
    var cells = reelCells(side, winnerPid, count);

    strip.innerHTML = cells.map(function (p, i) {
      return '<div class="rcell' + (i === cells.length - 1 ? " win" : "") + '" ' +
        'style="height:' + cellH + 'px;font-size:' + Math.round(cellH * 0.42) + 'px">' +
        '<i class="dot" style="background:' + U.esc(p.color) + '"></i>' +
        '<span class="nm">' + U.esc(p.name) + '</span></div>';
    }).join("");

    if (slot) { slot.style.top = cellH + "px"; slot.style.height = cellH + "px"; }

    var from = cellH;                          // cell 0 sitting in the middle slot
    var to = cellH - (cells.length - 1) * cellH;
    var t0 = performance.now();
    var lastCell = -1;
    var settled = false;

    function land(quiet) {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      strip.style.transform = "translateY(" + to.toFixed(1) + "px)";
      var box = U.q("#box-" + side);
      if (box) box.classList.add("locked");
      if (!quiet) U.sfx.reelStop();
      done();
    }

    /* requestAnimationFrame stops in a backgrounded tab. If the host alt-tabs
       away mid-spin the reel would never reach its last frame and the game
       would sit on the spin forever, so a wall-clock timer lands it regardless.
       setTimeout is throttled in the background too, but it still fires. */
    var guard = setTimeout(function () { land(true); }, dur + 1200);
    botT.push(guard);

    function frame(t) {
      if (G.phase !== "spin" || settled) return;
      var x = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - x, 4);          // ease-out quart: fast, then crawls
      var y = from + (to - from) * e;
      strip.style.transform = "translateY(" + y.toFixed(1) + "px)";
      var idx = Math.round((from - y) / cellH);
      if (idx !== lastCell) { lastCell = idx; if (x < 1) U.sfx.reelTick(); }
      if (x < 1) { reelRAF.push(requestAnimationFrame(frame)); return; }
      land(false);
    }
    reelRAF.push(requestAnimationFrame(frame));
  }

  /* ---------------- mic ---------------- */
  function paintMic() {
    var p = G.micPid ? P(G.micPid) : null;
    var side = G.micSide;
    var label = side === "a" ? (G.q ? G.q.a : "") : (G.q ? G.q.b : "");
    if (!p) { nextMic(); return; }

    var dots = G.micQueue.map(function (s, i) {
      return '<i class="' + (i === G.micIdx ? "on" : i < G.micIdx ? "done" : "") + '"></i>';
    }).join("");

    U.render(shell(
      '<div class="micstage ' + side + '">' +
        '<div class="mic-ghost">DEFEND IT</div>' +
        '<div class="mic-in">' +
          '<div class="mic-badge"><span class="k">' + side.toUpperCase() + '</span>' +
            '<span class="t">' + U.esc(label) + '</span></div>' +
          '<div class="mic-name" style="color:' + U.esc(p.color) + '">' + U.esc(p.name) + '</div>' +
          (p.org ? crestHTML(p.org, "lg") : '') +
          '<div class="mic-cue">Stand up. <em>Tell us why.</em></div>' +
          '<div class="mic-row">' + U.ringHTML("ring") +
            '<div class="mic-queue">' + dots + '</div></div>' +
        '</div>' +
      '</div>',
      '<button class="btn ghost" id="moreBtn">+15 seconds</button>' +
      '<button class="btn ghost" id="nextBtn">Done, next</button>' +
      '<span class="hint">Space when they finish</span>'
    ));
    U.on("#moreBtn", "click", function () { addMicTime(Math.round(15000 * TS)); });
    U.on("#nextBtn", "click", function () { clearTimeout(phaseT); U.sfx.micOff(); nextMic(); });
    fitMicSoon();
  }

  /* A long name in a chapter with a crest is a much taller block than a short
     one without, so the mic stage measures itself rather than trusting clamps. */
  function fitMic() { U.fitInto(U.q(".micstage"), U.q(".mic-in"), 0.35); }
  function fitMicSoon() { fitMic(); setTimeout(fitMic, 70); setTimeout(fitMic, 380); }

  /* ---------------- scores / final ---------------- */
  function paintScores() {
    var r = ranked();
    var cols = r.length > 24 ? 3 : r.length > 10 ? 2 : 1;
    var rows = Math.ceil(r.length / cols);
    U.render(shell(
      '<div class="board">' +
        '<div class="kicker" style="text-align:center">Standings after round ' + G.round + '</div>' +
        '<div class="board-grid ' + (cols === 3 ? "three" : cols === 2 ? "two" : "") +
          '" style="--rows:' + rows + '">' +
          r.map(function (p, i) {
            var g = G.gains[p.pid] || 0;
            return '<div class="row ' + (i === 0 ? "top1 " : i === 1 ? "top2 " : i === 2 ? "top3 " : "") +
              (g > 0 ? "rise" : "") + '" style="animation-delay:' + Math.min(i * 0.035, 1) + 's">' +
              '<span class="rk">' + (i + 1) + '</span>' +
              '<span class="dot" style="background:' + U.esc(p.color) + '"></span>' +
              '<span class="nm">' + U.esc(p.name) + '</span>' +
              (g > 0 ? '<span class="gain">+' + g + '</span>' : '') +
              '<span class="sc">' + p.score.toLocaleString() + '</span>' +
              '</div>';
          }).join("") +
        '</div>' +
      '</div>',
      '<button class="btn ghost" id="nextBtn">' + (G.round >= G.totalRounds ? "Final results" : "Next round") + '</button>' +
      '<span class="hint">Space to continue</span>'
    ));
    U.on("#nextBtn", "click", function () { clearTimeout(phaseT); nextRound(); });
  }

  function paintFinal() {
    var r = ranked();
    var order = [r[1], r[0], r[2]];
    var cls = ["p2", "p1", "p3"], marks = ["2", "1", "3"], crowns = ["", "👑", ""];
    U.render(shell(
      '<div class="stage" style="gap:clamp(12px,2vh,26px)">' +
        '<div class="burst"></div>' +
        '<div class="kicker">Final</div>' +
        '<div class="podium">' +
          order.map(function (p, i) {
            if (!p) return "";
            return '<div class="plinth ' + cls[i] + '">' +
              (crowns[i] ? '<div class="crown">' + crowns[i] + '</div>' : '') +
              '<div class="who" style="color:' + U.esc(p.color) + '">' + U.esc(p.name) + '</div>' +
              '<div class="sc">' + p.score.toLocaleString() + '</div>' +
              '<div class="base">' + marks[i] + '</div></div>';
          }).join("") +
        '</div>' +
        (G.awards && G.awards.length
          ? '<div class="awards">' + G.awards.map(function (a, i) {
              return '<div class="award" style="animation-delay:' + (0.7 + i * 0.12) + 's">' +
                '<div class="t">' + U.esc(a.title) + '</div>' +
                '<div class="w">' + U.esc(a.name) + '</div>' +
                '<div class="d">' + U.esc(a.desc) + '</div></div>';
            }).join("") + '</div>'
          : '') +
      '</div>',
      '<button class="btn" id="againBtn">Play again</button>' +
      '<button class="btn ghost" id="rosterBtn">Back to lobby</button>'
    ));
    U.on("#againBtn", "click", function () { resetScores(); startGame(); });
    U.on("#rosterBtn", "click", function () {
      resetScores();
      G.round = 0; G.gains = {};
      setPhase("lobby", 0);
    });
  }

  function resetScores() {
    list().forEach(function (p) { p.score = 0; });
    G.stats = {}; G.spoken = {};
    list().forEach(function (p) { stat(p.pid); });
  }

  function drawQR() {
    var el = U.q("#qr");
    if (!el || !window.QRCode || !G.code) return;
    el.innerHTML = "";
    try {
      new window.QRCode(el, {
        text: joinURL(),
        width: 320, height: 320,
        colorDark: "#08070B", colorLight: "#F6F0E2",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (e) {}
  }

  /* ---------------- ticker ---------------- */
  function tick() {
    if (!G) return;
    if (G.duration) {
      var el = U.q("#ring");
      if (el) U.setRing(el, msLeft(), G.duration);
    }
    var m = msLeft();
    if (G.duration && (G.phase === "pick" || G.phase === "mic")) {
      var s = Math.ceil(m / 1000);
      if (s <= 5 && s > 0 && s !== tick._last) { tick._last = s; U.sfx.tick(); }
    }
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (G.phase === "lobby") startGame();
      else if (G.phase === "pick") endPick();
      else if (G.phase === "split") { clearTimeout(phaseT); beginSpin(); }
      else if (G.phase === "spin") { clearTimeout(phaseT); beginMicSequence(); }
      else if (G.phase === "mic") { clearTimeout(phaseT); U.sfx.micOff(); nextMic(); }
      else if (G.phase === "scores") { clearTimeout(phaseT); nextRound(); }
    } else if (e.key === "m" || e.key === "M") {
      var m = !U.sfx.isMuted();
      U.sfx.setMuted(m);
      if (window.MUSIC) MUSIC.setMuted(m);
      U.toast(m ? "Muted" : "Sound on");
      var b = U.q("#muteBtn"); if (b) b.textContent = m ? "Sound off" : "Sound on";
    } else if (e.key === "b" || e.key === "B") {
      toggleMusic();
      U.toast(G.music ? "Music on" : "Music off");
      var mb = U.q("#musicBtn"); if (mb) mb.textContent = G.music ? "Music on" : "Music off";
    } else if ((e.key === "r" || e.key === "R") && G.phase === "spin") {
      respin("a"); respin("b");
    }
  }

  /* ---------------- music ---------------- */
  function toggleMusic() {
    G.music = !G.music;
    if (window.MUSIC) MUSIC.setEnabled(G.music);
    saveSetup();
  }

  /* Browsers will not let audio start until the host has interacted with the
     page, so arm it on the first click or key press and then get out of the way. */
  function armAudio() {
    function go() {
      document.removeEventListener("pointerdown", go);
      document.removeEventListener("keydown", go);
      if (window.MUSIC && G.music) MUSIC.start();
    }
    document.addEventListener("pointerdown", go);
    document.addEventListener("keydown", go);
    if (window.MUSIC && G.music) MUSIC.start();   // works if we already have a gesture
  }

  /* ---------------- boot ---------------- */
  function start() {
    newGame();
    U.keepAwake();
    paint();
    armAudio();

    net = NET.host({
      onReady: function (code) {
        G.code = code;
        painted = "";
        paint();
        U.toast("Room " + code + " is live");
      },
      onJoin: onJoin,
      onLeave: onLeave,
      onMsg: onMsg,
      onError: function (err) {
        U.toast("Connection problem: " + (err && err.type ? err.type : "unknown") + ". Reload the page.", true);
      }
    });

    clearInterval(tickT);
    tickT = setInterval(tick, 120);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && G.phase === "lobby") refitLobbySoon();
    });
    window.addEventListener("resize", function () {
      if (G.phase === "lobby") refitLobbySoon();
      else if (G.phase === "split") fitSplitSoon();
      else if (G.phase === "mic") fitMicSoon();
    });

    var bots = parseInt(params.get("bots") || "0", 10);
    if (bots > 0) {
      setTimeout(function () {
        addBots(Math.min(bots, 38));
        if (params.has("auto")) setTimeout(startGame, 600);
      }, 400);
    }

    var api = {
      get game() { return G; },
      addBots: addBots,
      start: startGame,
      /* jump past whatever is on screen right now */
      skip: function () {
        if (G.phase === "intro") { clearTimeout(phaseT); beginPick(); }
        else if (G.phase === "pick") endPick();
        else if (G.phase === "split") { clearTimeout(phaseT); beginSpin(); }
        else if (G.phase === "spin") { clearTimeout(phaseT); beginMicSequence(); }
        else if (G.phase === "mic") { clearTimeout(phaseT); nextMic(); }
        else if (G.phase === "scores") { clearTimeout(phaseT); nextRound(); }
      },
      /* re-run the slot machine. spin() does both sides, spin("a") does one. */
      spin: function (side) {
        if (G.phase !== "spin") { U.toast("Not on the spin"); return; }
        if (side) respin(side); else { respin("a"); respin("b"); }
      },
      jumpToEnd: function () { G.round = G.totalRounds; clearTimeout(phaseT); finish(); },
      music: function (on) { if (on !== undefined && on !== G.music) toggleMusic(); return G.music; },
      state: function () {
        var s = G.split;
        return {
          phase: G.phase,
          round: G.round + "/" + G.totalRounds,
          players: G.order.length,
          connected: active().length,
          code: G.code,
          question: G.q ? G.q.a + " / " + G.q.b : null,
          picks: Object.keys(G.picks).length,
          split: s ? (s.a + "/" + s.b + "  " + s.pctA + "%/" + s.pctB + "%") : null,
          spun: G.spin ? {
            a: G.spin.a.pid && P(G.spin.a.pid) ? P(G.spin.a.pid).name : null,
            b: G.spin.b.pid && P(G.spin.b.pid) ? P(G.spin.b.pid).name : null
          } : null,
          onMic: G.micPid && P(G.micPid) ? P(G.micPid).name : null,
          spoken: Object.keys(G.spoken).map(function (k) {
            return (P(k) ? P(k).name : k) + ":" + G.spoken[k];
          }),
          scores: ranked().map(function (p) { return p.name + ":" + p.score; })
        };
      }
    };
    window.TOT = api;
    window.SPLIT = api;    // the working name, kept as an alias so both work
  }

  window.HOST = { start: start };
})();
