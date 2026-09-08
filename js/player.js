/* THIS OR THAT - player (phone)
   Dumb client: sends "pick", renders whatever view the host pushes.
   It holds no game state of its own beyond a local countdown bar. */
(function () {
  "use strict";

  var U = window.UI;

  var me = { pid: null, name: "", color: "", org: "" };
  var code = "";
  var link = null;
  var view = null;
  var key = "";
  var localDeadline = 0, localTotal = 0;
  var barT = 0;
  var online = false;

  function pid() {
    var v = null;
    try { v = localStorage.getItem("tot.pid"); } catch (e) {}
    if (!v) {
      v = "p-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem("tot.pid", v); } catch (e) {}
    }
    return v;
  }

  function loadProfile() {
    try {
      var raw = JSON.parse(localStorage.getItem("tot.profile") || "{}");
      me.name = raw.name || "";
      me.color = raw.color || "";
      me.org = raw.org || "";
    } catch (e) {}
    me.pid = pid();
  }
  function saveProfile() {
    try {
      localStorage.setItem("tot.profile", JSON.stringify({ name: me.name, color: me.color, org: me.org }));
    } catch (e) {}
  }

  /* ---------------- join screen ---------------- */
  function paintJoin(err) {
    if (!me.color) me.color = U.COLORS[(Math.random() * U.COLORS.length) | 0];
    U.render(
      '<div class="phone">' +
        '<div class="phone-top">' +
          '<div class="host-brand"><div class="seal" style="width:44px;height:44px"><span style="font-size:15px">UGC</span></div>' +
          '<div class="name" style="font-size:17px">This or<em>That</em></div></div>' +
          '<div class="phone-score">' + U.esc(code) + '</div>' +
        '</div>' +
        '<div class="phone-body">' +
          (err ? '<div class="toast bad" style="position:static;transform:none;max-width:none">' + U.esc(err) + '</div>' : '') +
          '<div><label class="field-lbl" for="nm">Your name</label>' +
          '<input class="field" id="nm" maxlength="18" autocomplete="off" autocapitalize="words" ' +
          'placeholder="What everyone calls you" value="' + U.esc(me.name) + '"></div>' +
          '<div><span class="field-lbl">Your chapter (optional)</span>' +
          '<div class="orgpick-crests" id="orgs">' +
            window.ORGS.map(function (o) {
              return '<button data-org="' + U.esc(o.id) + '" aria-pressed="' + (me.org === o.id) + '" ' +
                'title="' + U.esc(o.name) + '">' +
                '<span class="crest" style="--cc:' + o.color + '">' +
                  '<span class="lt">' + o.letters + '</span>' +
                  '<span class="ab">' + U.esc(o.id) + '</span>' +
                '</span></button>';
            }).join("") +
          '</div></div>' +
          '<div><span class="field-lbl">Your colour</span>' +
          '<div class="swatches" id="sw">' +
            U.COLORS.map(function (c) {
              return '<button class="sw" data-c="' + c + '" style="background:' + c + '" aria-pressed="' + (me.color === c) + '"></button>';
            }).join("") +
          '</div></div>' +
        '</div>' +
        '<div class="phone-foot"><button class="btn block" id="go">Join the game</button></div>' +
      '</div>'
    );

    U.on("[data-org]", "click", function (e) {
      var o = e.currentTarget.getAttribute("data-org");
      me.org = me.org === o ? "" : o;
      U.qa("[data-org]").forEach(function (n) {
        n.setAttribute("aria-pressed", String(n.getAttribute("data-org") === me.org));
      });
      U.buzz(10);
    });
    U.on("[data-c]", "click", function (e) {
      me.color = e.currentTarget.getAttribute("data-c");
      U.qa("[data-c]").forEach(function (n) {
        n.setAttribute("aria-pressed", String(n.getAttribute("data-c") === me.color));
      });
      U.buzz(10);
    });
    U.on("#go", "click", submitJoin);
    U.on("#nm", "keydown", function (e) { if (e.key === "Enter") submitJoin(); });
    setTimeout(function () { var n = U.q("#nm"); if (n && !me.name) n.focus(); }, 250);
  }

  function submitJoin() {
    var n = U.q("#nm");
    var name = U.clean(n ? n.value : "", 18);
    if (!name) { U.toast("Put a name in first", true); if (n) n.focus(); return; }
    me.name = name;
    saveProfile();
    U.buzz(20);
    connect();
  }

  /* ---------------- networking ---------------- */
  function connect() {
    paintStatus("Connecting", "Hooking up to the room", true);
    if (link) link.destroy();
    link = NET.join(code, {
      onOpen: function () {
        online = true;
        link.send({ t: "join", pid: me.pid, name: me.name, color: me.color, org: me.org });
      },
      onMsg: function (msg) {
        if (!msg || msg.t !== "view") return;
        apply(msg);
      },
      onDrop: function () {
        online = false;
        var b = U.q("#offline");
        if (b) b.classList.remove("hidden");
      },
      onNoRoom: function () {
        if (!view) paintStatus("Room not found", "Check the code on the big screen, or scan the QR again. Still trying…", true);
      },
      onGiveUp: function () {
        paintStatus("Lost the room", "Reload this page to try again.", false);
      }
    });
  }

  /* ---------------- render ---------------- */
  function apply(v) {
    view = v;

    if (v.phase === "gone") {
      paintStatus("Removed", "The host restarted the game. Reload to rejoin.", false);
      return;
    }

    var k = [v.phase, v.seq, v.sub || "", v.picked || "", v.isYou ? 1 : 0].join("|");
    if (k !== key) {
      key = k;
      if (typeof v.ms === "number") {
        localDeadline = Date.now() + v.ms;
        localTotal = v.total || v.ms;
      } else {
        localDeadline = 0;
      }
      paintPhase(v);
    } else {
      patchHeader(v);
    }
  }

  function header(v) {
    return '<div class="phone-top">' +
      '<div class="phone-me"><span class="dot" style="background:' + U.esc(v.you.color) + '"></span>' +
      '<span class="nm">' + U.esc(v.you.name) + '</span></div>' +
      '<div class="phone-score" id="scoreN">' + (v.you.score || 0).toLocaleString() + '</div>' +
      '</div>' +
      '<div class="toast bad hidden" id="offline" style="position:static;transform:none;max-width:none;margin:0">' +
      'Reconnecting…</div>';
  }

  function patchHeader(v) {
    var s = U.q("#scoreN");
    if (s) s.textContent = (v.you.score || 0).toLocaleString();
    var nm = U.q(".phone-me .nm");
    if (nm) nm.textContent = v.you.name;
    var off = U.q("#offline");
    if (off) off.classList.toggle("hidden", online);
  }

  function timerBar() {
    return '<div class="bar" id="tbar"><i style="width:100%"></i></div>';
  }

  function paintStatus(big, sub, spin, cls) {
    U.render(
      '<div class="phone">' +
        (view ? header(view) : '<div class="phone-top"><div class="phone-me"><span class="nm">This or That</span></div>' +
          '<div class="phone-score">' + U.esc(code) + '</div></div>') +
        '<div class="phone-body"><div class="status">' +
          (spin ? '<div class="spinner"></div>' : '') +
          '<div class="big ' + (cls || "") + '">' + U.esc(big) + '</div>' +
          (sub ? '<div class="sub">' + U.esc(sub) + '</div>' : '') +
        '</div></div>' +
        '<div class="phone-foot"></div>' +
      '</div>'
    );
  }

  function pbtnHTML(side, label, art, picked) {
    return '<button class="pbtn ' + side + '" data-side="' + side + '" aria-pressed="' + (picked === side) + '">' +
      '<span class="k">' + side.toUpperCase() + '</span>' +
      (art ? '<img class="thumb" src="' + U.esc(art) + '" alt="" onerror="this.remove()">' : '') +
      '<span class="t ' + U.optClass(label) + '">' + U.esc(label) + '</span>' +
      '</button>';
  }

  function youreUpHTML(side, label, lead) {
    return '<div class="youreup ' + side + '">' +
      '<div class="big">You\'re up</div>' +
      '<div class="say">' + U.esc(lead) + '</div>' +
      '<div class="what">' + U.esc(label) + '</div>' +
      '</div>';
  }

  function paintPhase(v) {
    if (v.phase === "lobby") {
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big gold">You are in</div>' +
            '<div class="sub">' + v.count + ' player' + (v.count === 1 ? "" : "s") +
            ' so far. Keep an eye on the big screen.</div>' +
            '<div class="spinner"></div>' +
          '</div></div>' +
          '<div class="phone-foot"><button class="btn ghost block" id="edit">Change name or colour</button></div>' +
        '</div>'
      );
      U.on("#edit", "click", function () { key = ""; paintJoinEdit(); });
      return;
    }

    if (v.phase === "intro") {
      paintStatus("Round " + v.round, "of " + v.totalRounds + " — get ready", false, "gold");
      return;
    }

    if (v.phase === "pick") {
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body" style="justify-content:stretch">' +
            '<div class="kicker" style="text-align:center">' +
              U.esc(v.qsub || "Pick a side") + '</div>' +
            '<div class="pickpair">' +
              pbtnHTML("a", v.a, v.artA, v.picked) +
              pbtnHTML("b", v.b, v.artB, v.picked) +
            '</div>' +
          '</div>' +
          '<div class="phone-foot">' +
            '<div class="status" style="margin-bottom:10px"><div class="why">' +
              (v.picked ? "Locked in. You can still switch." : "Tap one") + '</div></div>' +
            timerBar() + '</div>' +
        '</div>'
      );
      U.on("[data-side]", "click", function (e) {
        var s = e.currentTarget.getAttribute("data-side");
        U.qa("[data-side]").forEach(function (n) {
          n.setAttribute("aria-pressed", String(n === e.currentTarget));
        });
        U.buzz(25);
        link.send({ t: "pick", side: s });
      });
      return;
    }

    if (v.phase === "split") {
      var mine = v.mine;
      var big, cls;
      if (!mine) { big = "You sat this one out"; cls = ""; }
      else if (v.majSide === null) { big = "Dead split"; cls = "gold"; }
      else if (mine === v.majSide) { big = "You read the room"; cls = "ok"; }
      else { big = "You went against it"; cls = "red"; }

      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big ' + cls + '">' + U.esc(big) + '</div>' +
            '<div class="minibar" id="mb">' +
              '<i class="a" style="width:50%">' + v.pctA + '%</i>' +
              '<i class="b" style="width:50%">' + v.pctB + '%</i>' +
            '</div>' +
            '<div class="sub">' + v.countA + ' picked ' + U.esc(v.a) + ' &middot; ' +
              v.countB + ' picked ' + U.esc(v.b) + '</div>' +
            (v.gained ? '<div class="pts">+' + v.gained + '</div>' : '') +
            (v.why ? '<div class="why">' + U.esc(v.why) + '</div>' : '') +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      // rAF for the nicest trigger, a timeout as the fallback for a phone whose
      // screen locked or whose browser backgrounded the tab and froze rAF.
      var setW = function () {
        var a = U.q(".minibar .a"), b = U.q(".minibar .b");
        if (a) a.style.width = v.pctA + "%";
        if (b) b.style.width = v.pctB + "%";
      };
      requestAnimationFrame(function () { requestAnimationFrame(setW); });
      setTimeout(setW, 60);
      U.buzz(v.gained ? [20, 50, 30] : 15);
      return;
    }

    if (v.phase === "spin") {
      if (!v.landed) {
        paintStatus("Spinning", "One person from each side is about to get called up.", true, "gold");
        return;
      }
      if (v.youSpun) {
        var side = v.spunA && v.mine === "a" ? "a" : "b";
        U.render(
          '<div class="phone">' + header(v) +
            '<div class="phone-body">' +
              youreUpHTML(v.mine || side, v.mine === "a" ? v.a : v.b, "Stand up and defend") +
            '</div>' +
            '<div class="phone-foot"></div>' +
          '</div>'
        );
        U.buzz([40, 60, 40, 60, 90]);
        return;
      }
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big gold">Not you</div>' +
            '<div class="sub">' +
              (v.spunA ? U.esc(v.spunA) + ' is defending "' + U.esc(v.a) + '"' : 'Nobody took "' + U.esc(v.a) + '"') +
              '<br>' +
              (v.spunB ? U.esc(v.spunB) + ' is defending "' + U.esc(v.b) + '"' : 'Nobody took "' + U.esc(v.b) + '"') +
            '</div>' +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      return;
    }

    if (v.phase === "mic") {
      if (v.isYou) {
        U.render(
          '<div class="phone">' + header(v) +
            '<div class="phone-body">' +
              youreUpHTML(v.side, v.option, "Talk. The room is listening.") +
              '<div class="status"><div class="pts">+' + v.gained + '</div>' +
              '<div class="why">for taking the mic</div></div>' +
            '</div>' +
            '<div class="phone-foot">' + timerBar() + '</div>' +
          '</div>'
        );
        U.buzz([30, 60, 30, 60, 30]);
        return;
      }
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big">' + U.esc(v.speaker) + '</div>' +
            '<div class="sub">is defending</div>' +
            '<div class="big ' + (v.side === "a" ? "red" : "gold") + '">' + U.esc(v.option) + '</div>' +
            '<div class="why">Listen up</div>' +
          '</div></div>' +
          '<div class="phone-foot">' + timerBar() + '</div>' +
        '</div>'
      );
      return;
    }

    if (v.phase === "scores") {
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big gold">#' + v.you.rank + '</div>' +
            '<div class="sub">of ' + v.of + ' after round ' + v.round + '</div>' +
            (v.gained ? '<div class="pts">+' + v.gained + ' this round</div>'
              : '<div class="sub">Nothing that round. Next one.</div>') +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      return;
    }

    if (v.phase === "final") {
      var first = v.you.rank === 1;
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            (first ? '<div class="shh">👑</div>' : '') +
            '<div class="big gold">#' + v.you.rank + ' of ' + v.of + '</div>' +
            '<div class="pts">' + (v.you.score || 0).toLocaleString() + '</div>' +
            (v.award ? '<div class="big ok" style="font-size:clamp(22px,7vw,34px)">' + U.esc(v.award) + '</div>' : '') +
            '<div class="sub">' + (first ? "You read this room all night." : "Winner: " + U.esc(v.winner || "—")) + '</div>' +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      if (first) U.confetti(4500);
      U.buzz([25, 60, 25, 60, 40]);
      return;
    }

    paintStatus("Hold tight", "Waiting for the big screen.", true);
  }

  function paintJoinEdit() {
    paintJoin();
    var go = U.q("#go");
    if (go) {
      go.textContent = "Save";
      go.addEventListener("click", function () {
        var n = U.q("#nm");
        var name = U.clean(n ? n.value : "", 18);
        if (!name) return;
        me.name = name;
        saveProfile();
        link.send({ t: "rename", name: me.name, color: me.color, org: me.org });
        key = "";
      }, true);
    }
  }

  /* ---------------- local countdown ---------------- */
  function tick() {
    var bar = U.q("#tbar");
    if (!bar) return;
    if (!localDeadline || !localTotal) { bar.style.opacity = "0"; return; }
    bar.style.opacity = "1";
    var left = Math.max(0, localDeadline - Date.now());
    var f = Math.max(0, Math.min(1, left / localTotal));
    var i = bar.firstElementChild;
    if (i) i.style.width = (f * 100).toFixed(1) + "%";
    bar.classList.toggle("low", left < 10000);
  }

  function start(roomCode) {
    code = String(roomCode || "").toUpperCase();
    loadProfile();
    clearInterval(barT);
    barT = setInterval(tick, 200);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && link && !link.isOpen()) {
        var b = U.q("#offline"); if (b) b.classList.remove("hidden");
      }
    });
    if (me.name) connect(); else paintJoin();

    window.TOT_PLAYER = {
      get view() { return view; },
      pick: function (side) { link.send({ t: "pick", side: side }); }
    };
  }

  window.PLAYER = { start: start };
})();
