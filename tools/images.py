"""THIS OR THAT - question artwork pipeline.

Images are PRE-GENERATED and committed. Nothing is generated in the browser at
an event: live generation would stall the projector for 5-10 seconds a question
and would put an API key in a public static site.

The generation call itself is made by an agent holding the OpenAI Toolbox MCP
tools (generate_image), because those are agent tools and a plain script cannot
call them. So this script owns the two halves either side of that:

    python tools/images.py plan
        Walks js/questions.js, merges tools/art_hints.json, and writes
        tools/image_plan.json - every image the bank needs, with the full
        prompt (subject + the one fixed art-direction suffix) already built.
        Prints what is missing from img/ so you can regenerate just the gaps.

        --pack classic,campus     only these packs
        --missing                 only images not already in img/
        --prompts                 print the prompts, one per line, for pasting

    python tools/images.py fetch urls.json
        urls.json is {"<image key>": "<url>", ...} as returned by the image
        tool. Downloads each, squares and resizes it, saves img/<key>.jpg, and
        rewrites js/art.js so the game knows which questions have art.

        --size 512  --quality 80

    python tools/images.py manifest
        Rewrites js/art.js from whatever is actually in img/. Run this after
        deleting or hand-replacing a file.

To extend the bank: add questions to js/questions.js, optionally add art hints
for them here, run `plan --missing`, generate, then `fetch`. A question with no
image is not broken - it renders as a bold type-only card by design.
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
QUESTIONS_JS = os.path.join(ROOT, "js", "questions.js")
ART_JS = os.path.join(ROOT, "js", "art.js")
IMG_DIR = os.path.join(ROOT, "img")
HINTS = os.path.join(HERE, "art_hints.json")
PLAN = os.path.join(HERE, "image_plan.json")

# The one fixed art direction, appended to every single prompt. This is what
# makes 60 pictures read as one deliberate collection instead of 60 unrelated
# ones, so do not vary it per question - vary only the subject line.
STYLE = (
    "STYLE: bold flat poster illustration, thick confident black linework, "
    "screen-print and risograph feel. Strictly limited palette: warm gold #FFC53D, "
    "crimson red #E8384F, cream #F6F0E2, on a near-black #08070B background. "
    "Simple graphic shapes, high contrast, one clear centred subject, generous "
    "negative space, subtle halftone dot texture and light print grain. "
    "No text, no letters, no numbers, no words, no logos, no brand marks, no watermarks. "
    "No recognisable real people and no celebrity faces. "
    "Square composition, filling the frame edge to edge, no border, no frame."
)

# Only these packs get artwork for now. Greek Life, Deep Cuts and Chaos ship as
# type-only cards until someone from UGC has reviewed their wording.
DEFAULT_PACKS = ["classic", "campus"]

Q_RE = re.compile(
    r'\{\s*id:\s*"([^"]+)"\s*,\s*p:\s*"([^"]+)"\s*,\s*a:\s*"([^"]*)"\s*,\s*b:\s*"([^"]*)"',
    re.S,
)


def questions():
    """Parse js/questions.js. It stays the single hand-edited source of truth,
    so this reads it rather than keeping a duplicate list over here."""
    src = io.open(QUESTIONS_JS, encoding="utf-8").read()
    start = src.index("window.QUESTIONS")
    end = src.index("window.PACKS")
    out = []
    for m in Q_RE.finditer(src[start:end]):
        out.append({"id": m.group(1), "pack": m.group(2), "a": m.group(3), "b": m.group(4)})
    if not out:
        sys.exit("Parsed no questions out of js/questions.js - has its shape changed?")
    return out


def hints():
    if not os.path.exists(HINTS):
        return {}
    return json.load(io.open(HINTS, encoding="utf-8"))


def build_plan(packs, only_missing):
    hint = hints()
    items = []
    for q in questions():
        if packs and q["pack"] not in packs:
            continue
        for side in ("a", "b"):
            key = "%s-%s" % (q["id"], side)
            if only_missing and os.path.exists(os.path.join(IMG_DIR, key + ".jpg")):
                continue
            # A hint is a refinement, not a requirement. With none, the option
            # label itself is a serviceable subject line.
            subject = hint.get(key) or q[side]
            items.append({
                "key": key,
                "pack": q["pack"],
                "option": q[side],
                "prompt": subject.rstrip(". ") + ". " + STYLE,
            })
    return items


def cmd_plan(args):
    packs = [p.strip() for p in args.pack.split(",") if p.strip()] if args.pack else DEFAULT_PACKS
    items = build_plan(packs, args.missing)
    json.dump(items, io.open(PLAN, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    have = sum(1 for i in items if os.path.exists(os.path.join(IMG_DIR, i["key"] + ".jpg")))
    if args.prompts:
        for i in items:
            print("%s\t%s" % (i["key"], i["prompt"]))
        return
    print("packs      : %s" % ", ".join(packs))
    print("images     : %d needed, %d already in img/" % (len(items), have))
    print("plan       : %s" % os.path.relpath(PLAN, ROOT))
    missing = [i["key"] for i in items if not os.path.exists(os.path.join(IMG_DIR, i["key"] + ".jpg"))]
    if missing:
        print("missing    : %d" % len(missing))
        for k in missing[:12]:
            print("             %s" % k)
        if len(missing) > 12:
            print("             ... and %d more" % (len(missing) - 12))
    else:
        print("missing    : none, the set is complete")


def square(im, size):
    """Centre-crop to a square then resize. The tiles are square on screen, so
    cropping here beats letterboxing or squashing there."""
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    return im.resize((size, size), 1)  # 1 == LANCZOS across Pillow versions


def cmd_fetch(args):
    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow is needed to resize: pip install pillow")

    urls = json.load(io.open(args.urls, encoding="utf-8"))
    if not isinstance(urls, dict):
        sys.exit("urls.json should be an object of {\"<key>\": \"<url>\"}")
    os.makedirs(IMG_DIR, exist_ok=True)

    ok, failed = 0, []
    for key, url in urls.items():
        dest = os.path.join(IMG_DIR, key + ".jpg")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "thisorthat/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            square(im, args.size).save(dest, "JPEG", quality=args.quality, optimize=True)
            ok += 1
            print("  %-26s %6.1f KB" % (key, os.path.getsize(dest) / 1024.0))
        except Exception as e:
            failed.append("%s: %s" % (key, e))

    print("saved %d, failed %d" % (ok, len(failed)))
    for f in failed:
        print("  FAILED %s" % f)
    write_manifest()


def write_manifest():
    keys = sorted(
        f[:-4] for f in os.listdir(IMG_DIR)
        if f.endswith(".jpg") and not f.startswith(".")
    )
    body = "".join('  "%s": 1,\n' % k for k in keys)
    if body:
        body = body[:-2] + "\n"
    src = (
        "/* THIS OR THAT - image manifest.\n"
        "   GENERATED FILE. Do not hand-edit: rewritten by tools/images.py.\n\n"
        "   Keys are \"<question id>-<a|b>\". A key being present means\n"
        "   img/<key>.jpg exists in this repo. A question with no entry renders\n"
        "   as a type-only card, which is a designed state - the game never\n"
        "   requests an image it does not have, so there is nothing to 404 and\n"
        "   nothing to break at an event. */\n"
        "window.ART = {\n" + body + "};\n"
    )
    io.open(ART_JS, "w", encoding="utf-8", newline="\n").write(src)
    total = sum(os.path.getsize(os.path.join(IMG_DIR, k + ".jpg")) for k in keys)
    print("js/art.js  : %d images, %.1f MB in img/" % (len(keys), total / 1048576.0))


def cmd_manifest(args):
    write_manifest()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan", help="build the prompt list for the question bank")
    p.add_argument("--pack", help="comma separated packs (default: %s)" % ",".join(DEFAULT_PACKS))
    p.add_argument("--missing", action="store_true", help="only images not already in img/")
    p.add_argument("--prompts", action="store_true", help="print key<TAB>prompt lines")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("fetch", help="download generated images and rebuild js/art.js")
    p.add_argument("urls", help='json file of {"<key>": "<url>"}')
    p.add_argument("--size", type=int, default=512)
    p.add_argument("--quality", type=int, default=80)
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("manifest", help="rebuild js/art.js from what is in img/")
    p.set_defaults(func=cmd_manifest)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
