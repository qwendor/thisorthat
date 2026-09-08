/* THIS OR THAT - shared UI helpers
   Same shape as Spill the Letters' ui.js. Differences: the sound bank has the
   slot-machine voices in it, and there is a text-fitting helper for the two
   option tiles instead of a prompt formatter. */
(function () {
  "use strict";

  var app = null;
  function root() { return app || (app = document.getElementById("app")); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(html) { root().innerHTML = html; return root(); }
  function q(sel, scope) { return (scope || document).querySelector(sel); }
  function qa(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }

  function on(sel, ev, fn, scope) {
    qa(sel, scope).forEach(function (n) { n.addEventListener(ev, fn); });
  }

  /* Player colours - readable on black and distinct from each other.
     32 of them, so a room of 25 (or a walk-in 30th) never has two people
     sharing one. Ordered so the first dozen are the most distinguishable. */
  var COLORS = [
    "#FFC53D", "#E8384F", "#4CD98A", "#4CC9F0", "#B57BFF", "#FF8A3D",
    "#FF6FB5", "#6EE7C8", "#F2E14C", "#7C9CFF", "#FF5C5C", "#9BE15D",
    "#00D3C7", "#D66BFF", "#FFA8A8", "#5CE1E6", "#C6F04E", "#3FBF5F",
    "#2E8BFF", "#8A6BFF", "#FF4FD8", "#A0E9FF", "#D9D2C5", "#E0A85C",
    "#7FD1B9", "#FF9770", "#B0C4FF", "#DDA0DD", "#9AD5CA", "#F7B32B",
    "#6BD6E8", "#C48FFF"
  ];

  /* Option labels vary from "Cats" to "Famous for something dumb". Pick a size
     class rather than one clamp that has to serve both. */
  function optClass(text) {
    var n = (text || "").length;
    if (n > 24) return "xlong";
    if (n > 14) return "long";
    return "";
  }

  function ringHTML(id) {
    return '<div class="ring" id="' + id + '">' +
      '<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44" fill="none" stroke-width="8"/>' +
      '<circle class="bar" cx="50" cy="50" r="44" fill="none" stroke-width="8" stroke-linecap="round" ' +
      'stroke-dasharray="276.5" stroke-dashoffset="0"/></svg>' +
      '<div class="num">0</div></div>';
  }

  function setRing(el, msLeft, msTotal) {
    if (!el) return;
    var f = msTotal > 0 ? Math.max(0, Math.min(1, msLeft / msTotal)) : 0;
    var bar = el.querySelector(".bar");
    var num = el.querySelector(".num");
    if (bar) bar.style.strokeDashoffset = String(276.5 * (1 - f));
    var secs = Math.max(0, Math.ceil(msLeft / 1000));
    if (num && num.textContent !== String(secs)) num.textContent = String(secs);
    el.classList.toggle("low", secs <= 10);
  }

  /* ---------------- sound (host screen only) ---------------- */
  var actx = null, muted = false;
  function ctx() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, dur, type, vol, delay) {
    var c = ctx(); if (!c || muted) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.16 : vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  /* A short noise burst. The reel stop and the drum hits want texture, not a
     pure tone - a sine "thunk" alone sounds like a UI beep, not a machine. */
  function noise(dur, hp, vol, delay, rate) {
    var c = ctx(); if (!c || muted) return;
    var t0 = c.currentTime + (delay || 0);
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf;
    if (rate) s.playbackRate.value = rate;
    f.type = "highpass"; f.frequency.value = hp || 900;
    g.gain.setValueAtTime(vol == null ? 0.12 : vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  var sfx = {
    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; },
    join:    function () { tone(660, 0.10, "triangle", 0.10); tone(990, 0.12, "triangle", 0.08, 0.07); },
    submit:  function () { tone(520, 0.08, "square", 0.07); },
    start:   function () { [392, 523, 659, 784].forEach(function (f, i) { tone(f, 0.22, "triangle", 0.12, i * 0.09); }); },
    tick:    function () { tone(1200, 0.04, "square", 0.05); },
    round:   function () { tone(330, 0.16, "square", 0.10); tone(494, 0.22, "square", 0.10, 0.11); },
    lock:    function () { tone(740, 0.07, "square", 0.06); tone(1108, 0.09, "square", 0.05, 0.05); },

    /* the split bar sliding into place, then landing */
    slide:   function () { tone(180, 0.55, "sawtooth", 0.05); },
    splitHit:function () {
      noise(0.24, 260, 0.20, 0, 0.7);
      tone(110, 0.34, "sine", 0.22);
      [330, 440, 660].forEach(function (f, i) { tone(f, 0.30, "triangle", 0.09, i * 0.035); });
    },

    /* slot machine: a click per name that goes past, a hard stop at the end */
    reelTick:function () { noise(0.028, 2400, 0.10, 0, 1.6); tone(1500, 0.02, "square", 0.035); },
    reelStop:function () {
      noise(0.30, 180, 0.30, 0, 0.55);
      tone(84, 0.42, "sine", 0.26);
      tone(168, 0.20, "triangle", 0.12, 0.01);
    },
    fanfare: function () { [523, 659, 784].forEach(function (f, i) { tone(f, 0.26, "triangle", 0.13, i * 0.07); }); },

    micOn:   function () { tone(392, 0.14, "triangle", 0.12); tone(587, 0.26, "triangle", 0.12, 0.10); },
    micOff:  function () { tone(392, 0.20, "triangle", 0.10); tone(262, 0.34, "triangle", 0.10, 0.12); },
    right:   function () { [659, 880].forEach(function (f, i) { tone(f, 0.18, "triangle", 0.12, i * 0.08); }); },
    wrong:   function () { tone(180, 0.28, "sawtooth", 0.09); },
    win:     function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.45, "triangle", 0.13, i * 0.13); }); }
  };

  function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 20); } catch (e) {} } }

  /* ---------------- toast ---------------- */
  var toastEl = null, toastT = 0;
  function toast(msg, bad) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.className = "toast" + (bad ? " bad" : "");
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);
    clearTimeout(toastT);
    toastT = setTimeout(function () {
      if (toastEl) { toastEl.remove(); toastEl = null; }
    }, bad ? 5000 : 2600);
  }

  /* ---------------- confetti ---------------- */
  function confetti(ms, cols) {
    var cv = document.createElement("canvas");
    cv.className = "confetti";
    document.body.appendChild(cv);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    size();
    var g = cv.getContext("2d");
    var palette = cols && cols.length ? cols : ["#FFC53D", "#E8384F", "#F6F0E2", "#4CD98A", "#B57BFF"];
    var bits = [];
    for (var i = 0; i < 220; i++) {
      bits.push({
        x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.6,
        w: (6 + Math.random() * 9) * dpr, h: (9 + Math.random() * 14) * dpr,
        vy: (2.2 + Math.random() * 4) * dpr, vx: (Math.random() - 0.5) * 2.6 * dpr,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.24,
        c: palette[(Math.random() * palette.length) | 0]
      });
    }
    var end = performance.now() + (ms || 5200);
    (function loop(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        if (b.y > cv.height + 40) { b.y = -30; b.x = Math.random() * cv.width; }
        g.save(); g.translate(b.x, b.y); g.rotate(b.rot);
        g.fillStyle = b.c; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); g.restore();
      });
      if (t < end) requestAnimationFrame(loop);
      else cv.remove();
    })(performance.now());
  }

  /* ---------------- misc ---------------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    var lock = null;
    function get() {
      navigator.wakeLock.request("screen").then(function (l) {
        lock = l;
        l.addEventListener("release", function () { lock = null; });
      }).catch(function () {});
    }
    get();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !lock) get();
    });
  }

  function clean(s, max) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max || 40);
  }

  /* Scale a block down until it fits its track. Used everywhere a list can be
     6 items or 30 and the host laptop can be 1366x768 or 1920x1080. Measuring
     beats hand-tuned clamps, which only ever fit the screen they were tuned on. */
  function fitInto(outer, inner, minScale) {
    if (!outer || !inner) return 1;
    inner.style.transform = "none";
    var availH = outer.clientHeight, availW = outer.clientWidth;
    var needH = inner.offsetHeight, needW = inner.offsetWidth;
    if (!availH || !needH) return 1;
    var k = Math.min(1, availH / needH, availW ? availW / Math.max(1, needW) : 1);
    k = Math.max(minScale == null ? 0.35 : minScale, k);
    inner.style.transform = k < 0.999 ? "scale(" + k.toFixed(3) + ")" : "none";
    return k;
  }

  window.UI = {
    esc: esc, render: render, q: q, qa: qa, on: on, root: root,
    audioCtx: ctx,
    COLORS: COLORS, optClass: optClass,
    ringHTML: ringHTML, setRing: setRing,
    sfx: sfx, tone: tone, noise: noise,
    buzz: buzz, toast: toast, confetti: confetti,
    shuffle: shuffle, keepAwake: keepAwake, clean: clean, fitInto: fitInto
  };
})();
