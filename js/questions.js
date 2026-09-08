/* THIS OR THAT - question bank

   Every question is two options that a room of 25 should genuinely argue about.
   The design rule: if 24 out of 25 pick the same one, the round is dead AND the
   person spun on the losing side has nothing to say. So both sides have to be
   defensible out loud.

   id    short slug, also the image filename stem: img/<id>-a.jpg / <id>-b.jpg
   p     pack: classic | campus | greek | deep | chaos
   a,b   the two options, kept short enough to read from the back of a room
   sub   optional one-line framing shown above the options

   Art lives in img/ and is listed in js/art.js (written by tools/images.py).
   A question with no art renders a bold type-only card instead, which is a
   designed state, not a failure state.                                       */

window.QUESTIONS = [
  /* ---------------- CLASSIC ---------------- */
  { id: "beach-mountain", p: "classic", a: "Beach trip",        b: "Mountain trip" },
  { id: "text-call",      p: "classic", a: "Text me",           b: "Just call me" },
  { id: "morning-night",  p: "classic", a: "Morning person",    b: "Night owl" },
  { id: "sweet-savory",   p: "classic", a: "Sweet breakfast",   b: "Savory breakfast" },
  { id: "window-aisle",   p: "classic", a: "Window seat",       b: "Aisle seat" },
  { id: "party-hangout",  p: "classic", a: "Big party",         b: "Small hangout" },
  { id: "summer-winter",  p: "classic", a: "Summer",            b: "Winter" },
  { id: "cats-dogs",      p: "classic", a: "Cats",              b: "Dogs" },
  { id: "theater-couch",  p: "classic", a: "Movie theater",     b: "Couch at home" },
  { id: "plan-wing",      p: "classic", a: "Plan every hour",   b: "Wing the whole day" },
  { id: "coffee-energy",  p: "classic", a: "Coffee",            b: "Energy drink" },
  { id: "front-back",     p: "classic", a: "Front row",         b: "Back row" },
  { id: "loud-messy",     p: "classic", a: "Loud roommate",     b: "Messy roommate",
    sub: "You have to live with one" },
  { id: "group-solo",     p: "classic", a: "Group project",     b: "Solo project" },
  { id: "aux-never",      p: "classic", a: "Always on aux",     b: "Never touching aux" },

  /* ---------------- CAMPUS (VCU / RVA) ---------------- */
  { id: "cabell-floor",   p: "campus",  a: "Cabell 1st floor",  b: "Cabell 4th floor",
    sub: "Where you actually get work done" },
  { id: "shafer-off",     p: "campus",  a: "Shafer",            b: "Off-campus food" },
  { id: "monroe-compass", p: "campus",  a: "Monroe Park",       b: "The Compass",
    sub: "First warm day of the semester" },
  { id: "walk-pulse",     p: "campus",  a: "Walk it",           b: "Take the Pulse" },
  { id: "carytown-scotts",p: "campus",  a: "Carytown",          b: "Scott's Addition" },
  { id: "mamaj-kuba",     p: "campus",  a: "Mama J's",          b: "Kuba Kuba" },
  { id: "eightam-eightpm",p: "campus",  a: "8 AM class",        b: "8 PM class" },
  { id: "on-off-campus",  p: "campus",  a: "Living on campus",  b: "Living off campus" },
  { id: "cookout-waffle", p: "campus",  a: "Cookout run",       b: "Waffle House run",
    sub: "It is 1 AM" },
  { id: "deck-street",    p: "campus",  a: "Parking deck",      b: "Street parking" },
  { id: "sbux-lamp",      p: "campus",  a: "Starbucks",         b: "Lamplighter" },
  { id: "siegel-couch",   p: "campus",  a: "Siegel Center",     b: "Watch from the couch" },
  { id: "merch-never",    p: "campus",  a: "VCU merch daily",   b: "Never wearing merch" },
  { id: "library-bed",    p: "campus",  a: "Study in the library", b: "Study in your bed" },
  { id: "sugar-krispy",   p: "campus",  a: "Sugar Shack",       b: "Krispy Kreme" },

  /* ---------------- GREEK LIFE / UGC ---------------- */
  { id: "stroll-table",   p: "greek",   a: "Stroll practice",   b: "Tabling on the Compass" },
  { id: "bigevent-dinner",p: "greek",   a: "Big chapter event", b: "Small chapter dinner" },
  { id: "matching-own",   p: "greek",   a: "Matching fits",     b: "Everyone does their own" },
  { id: "front-back-line",p: "greek",   a: "Front of the line", b: "Back of the line",
    sub: "Where you want to be in the stroll" },
  { id: "gc-loud-dead",   p: "greek",   a: "Group chat never stops", b: "Group chat is dead" },
  { id: "phil-social",    p: "greek",   a: "Philanthropy event", b: "Social event" },
  { id: "planner-shower", p: "greek",   a: "The planner",       b: "The one who shows up" },
  { id: "letters-daily",  p: "greek",   a: "Letters every day", b: "Letters only at events" },
  { id: "yardshow-formal",p: "greek",   a: "Yard show",         b: "Formal" },
  { id: "recruit-process",p: "greek",   a: "Recruitment week",  b: "New member process",
    sub: "Which one you would relive" },

  /* ---------------- DEEP CUTS ---------------- */
  { id: "truth-peace",    p: "deep",    a: "Tell the truth",    b: "Keep the peace" },
  { id: "city-town",      p: "deep",    a: "Big city",          b: "Small town" },
  { id: "money-passion",  p: "deep",    a: "Chase the money",   b: "Chase the passion" },
  { id: "home-far",       p: "deep",    a: "Stay close to home", b: "Move far away" },
  { id: "respect-liked",  p: "deep",    a: "Be respected",      b: "Be liked" },
  { id: "future-past",    p: "deep",    a: "Know the future",   b: "Change the past" },
  { id: "five-fifty",     p: "deep",    a: "Five close friends", b: "Fifty good friends" },
  { id: "say-think",      p: "deep",    a: "Say what you think", b: "Think before you say it" },
  { id: "family-friends", p: "deep",    a: "Family holidays",   b: "Friends holidays" },
  { id: "startover-build",p: "deep",    a: "Start over somewhere new", b: "Build where you are" },

  /* ---------------- CHAOS ---------------- */
  { id: "duck-horses",    p: "chaos",   a: "One horse-sized duck", b: "100 duck-sized horses",
    sub: "You have to fight one" },
  { id: "early-late",     p: "chaos",   a: "Always 10 min early", b: "Always 10 min late" },
  { id: "minds-invisible",p: "chaos",   a: "Read minds",        b: "Turn invisible" },
  { id: "fork-chair",     p: "chaos",   a: "Never use a fork",  b: "Never use a chair" },
  { id: "sing-dance",     p: "chaos",   a: "Sing every sentence", b: "Dance everywhere you go" },
  { id: "goose-raccoon",  p: "chaos",   a: "Fight a goose",     b: "Fight a raccoon" },
  { id: "flights-food",   p: "chaos",   a: "Free flights forever", b: "Free food forever" },
  { id: "roll-chats",     p: "chaos",   a: "Delete your camera roll", b: "Delete your group chats" },
  { id: "famous-unknown", p: "chaos",   a: "Famous for something dumb", b: "Never known at all" },
  { id: "hot-cold",       p: "chaos",   a: "Always too hot",    b: "Always too cold" },
  { id: "emoji-quotes",   p: "chaos",   a: "Only speak in emojis", b: "Only speak in movie quotes" },
  { id: "music-dessert",  p: "chaos",   a: "Live without music", b: "Live without dessert" }
];

window.PACKS = [
  { id: "classic", label: "Classic" },
  { id: "campus",  label: "Campus" },
  { id: "greek",   label: "Greek Life" },
  { id: "deep",    label: "Deep Cuts" },
  { id: "chaos",   label: "Chaos" }
];

/* UGC chapters, as listed on fsl.vcu.edu. Each one is rendered as its Greek
   LETTERS set in this game's display face. We deliberately do not reproduce any
   chapter's real crest or badge, and we do not AI-generate look-alikes: those
   are the organisations' own registered marks. The colours below are this
   game's palette, not any chapter's official colours. Same rule as
   Spill the Letters.                                                          */
window.ORGS = [
  { id: "LTA",    letters: "ΛΘΑ",  name: "Lambda Theta Alpha",    color: "#E8384F" },
  { id: "aKDPhi", letters: "αΚΔΦ", name: "alpha Kappa Delta Phi", color: "#B57BFF" },
  { id: "KPG",    letters: "ΚΦΓ",  name: "Kappa Phi Gamma",       color: "#FF8A3D" },
  { id: "LTP",    letters: "ΛΘΦ",  name: "Lambda Theta Phi",      color: "#4CC9F0" },
  { id: "LAU",    letters: "ΛΑΥ",  name: "Lambda Alpha Upsilon",  color: "#FFC53D" },
  { id: "APsiL",  letters: "ΑΨΛ",  name: "Alpha Psi Lambda",      color: "#4CD98A" },
  { id: "LUL",    letters: "ΛΥΛ",  name: "Lambda Upsilon Lambda", color: "#FF6FB5" },
  { id: "SLU",    letters: "ΣΛΥ",  name: "Sigma Lambda Upsilon",  color: "#6EE7C8" },
  { id: "Guest",  letters: "★",    name: "Not in a chapter",      color: "#D9D2C5" }
];

window.ORG_BY_ID = {};
window.ORGS.forEach(function (o) { window.ORG_BY_ID[o.id] = o; });

/* Names for the offline test bots (?bots=N). */
window.BOT_NAMES = [
  "Ana", "Marcus", "Priya", "Jayden", "Sofia", "Kenji", "Imani", "Diego",
  "Leilani", "Omar", "Yuki", "Camila", "Tobi", "Nadia", "Rafa", "Mei",
  "Andres", "Zara", "Kofi", "Lucia", "Sam", "Trini", "Devon", "Rin",
  "Bea", "Malik", "Noor", "Elena", "Tavi", "Jun", "Rosa", "Cyrus",
  "Ife", "Paloma", "Nico", "Asha", "Teo", "Lina", "Hassan", "Vera"
];
