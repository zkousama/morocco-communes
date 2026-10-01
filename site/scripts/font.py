"""
The site's Arabic face: Bouazzi Maghribi with the letters Moroccan place names use and it
lacks, written to site/public/fonts as Communes Maghribi. `pnpm site:font`; needs fontTools
and brotli (pip install fonttools brotli).

HCP writes the hard g of 1,300-odd douar names with ݣ, and some with ڭ or گ; a few more
names use ک, پ, چ or the presentation form ﻻ. Bouazzi has none of them, so a browser drew
that one letter in another face and broke the word's joining. Each is added here from
glyphs the font already has: a base letter and one of its own dot marks, joined by a ccmp
rule, so the font's joining forms and mark anchors place them as they place every other
letter; ﻻ points at the lam-alef the font already draws. Nothing is drawn by hand.

گ is a gaf, a kaf with a second stroke, and Bouazzi has no such stroke. It's drawn the way
Moroccan writing marks a g, as a kaf with 3 dots, the same as ݣ.

The font's licence reserves the name Bouazzi Maghribi, so the changed font carries another.
"""
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables as ot

SOURCE = Path("site/fonts/BouazziMaghribi-Regular.woff2")
OUT = Path("site/public/fonts/CommunesMaghribi-Regular.woff2")
FAMILY = ("Bouazzi Maghribi", "Communes Maghribi")
POSTSCRIPT = ("BouazziMaghribi", "CommunesMaghribi")

# Each added character, its glyph name, and the glyphs it's made of: a base and a mark.
ADDED = [
    (0x0763, "uni0763", ["uni0643", "threedotsupabovear"]),  # ݣ keheh with 3 dots above
    (0x06AD, "uni06AD", ["uni0643", "threedotsupabovear"]),  # ڭ ng
    (0x06AF, "uni06AF", ["uni0643", "threedotsupabovear"]),  # گ gaf, as a Moroccan g
    (0x06A9, "uni06A9", ["uni0643"]),  # ک keheh: Bouazzi's kaf has no inner mark already
    (0x067E, "uni067E", ["uni066E", "threedotsdownbelowar"]),  # پ peh, on the dotless beh
    (0x0686, "uni0686", ["uni062D", "threedotsdownbelowar"]),  # چ tcheh, on the hah
]
# Characters the font already has a glyph for, under another code point.
MAPPED = [(0xFEFB, "uni06440627")]  # ﻻ, the isolated lam-alef the font's rlig makes
FORMS = ["", ".init", ".medi", ".fina"]


def anchors(font):
    """(base, mark) -> the offset that puts the mark on the base, from the font's own marks."""
    found = {}
    for lookup in font["GPOS"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            table = sub.ExtSubTable if lookup.LookupType == 9 else sub
            if type(table).__name__ != "MarkBasePos":
                continue
            marks = table.MarkCoverage.glyphs
            for b, base in enumerate(table.BaseCoverage.glyphs):
                for m, mark in enumerate(marks):
                    record = table.MarkArray.MarkRecord[m]
                    anchor = table.BaseArray.BaseRecord[b].BaseAnchor[record.Class]
                    if anchor is None:
                        continue
                    found.setdefault((base, mark), (anchor.XCoordinate - record.MarkAnchor.XCoordinate, anchor.YCoordinate - record.MarkAnchor.YCoordinate))
    return found


def main():
    font = TTFont(SOURCE)
    order = font.getGlyphOrder()
    glyphs = font.getGlyphSet()
    placed = anchors(font)

    # Every form of every base has to carry the mark, or a word would show it misplaced.
    problems = []
    for _, name, parts in ADDED:
        if len(parts) != 2 or parts[1] not in glyphs or not parts[1].endswith("ar"):
            continue
        base, mark = parts
        for form in FORMS:
            if base + form in glyphs and (base + form, mark) not in placed:
                problems.append(f"{name}: {base + form} has no anchor for {mark}")
    if problems:
        sys.exit("can't place every form:\n  " + "\n  ".join(problems))

    cff = font["CFF "].cff
    top = cff.topDictIndex[0]
    charstrings = top.CharStrings
    for code, name, parts in ADDED:
        if name in glyphs:
            sys.exit(f"{name} is already in the font")
        # The outline is only seen where ccmp isn't applied: the base with its mark in place.
        base = parts[0]
        width = glyphs[base].width
        pen = T2CharStringPen(width, glyphs)
        bounds = BoundsPen(glyphs)
        for part in parts:
            dx, dy = placed.get((base, part), (0, 0)) if part != base else (0, 0)
            glyphs[part].draw(TransformPen(pen, (1, 0, 0, 1, dx, dy)))
            glyphs[part].draw(TransformPen(bounds, (1, 0, 0, 1, dx, dy)))
        charstring = pen.getCharString(private=top.Private, globalSubrs=cff.GlobalSubrs)
        charstrings.charStringsIndex.append(charstring)
        charstrings.charStrings[name] = len(charstrings.charStringsIndex) - 1
        order.append(name)  # the CFF charset, which is the font's glyph order
        font["hmtx"][name] = (width, int(bounds.bounds[0]) if bounds.bounds else 0)
        font["vmtx"][name] = font["vmtx"][base]
        for table in font["cmap"].tables:
            if table.isUnicode() and (code <= 0xFFFF or table.format == 12):
                table.cmap[code] = name
        font["GDEF"].table.GlyphClassDef.classDefs[name] = 1
    font.setGlyphOrder(order)
    for code, name in MAPPED:
        if name not in glyphs:
            sys.exit(f"{name} isn't in the font")
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[code] = name

    gsub = font["GSUB"].table
    lookup = ot.Lookup()
    lookup.LookupType = 2
    lookup.LookupFlag = 0
    sub = ot.MultipleSubst()
    sub.mapping = {name: parts for _, name, parts in ADDED}
    lookup.SubTable = [sub]
    lookup.SubTableCount = 1
    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
    index = gsub.LookupList.LookupCount - 1
    ccmp = [r for r in gsub.FeatureList.FeatureRecord if r.FeatureTag == "ccmp"]
    if not ccmp:
        sys.exit("the font has no ccmp feature to add the rule to")
    for record in ccmp:
        record.Feature.LookupListIndex.append(index)
        record.Feature.LookupCount = len(record.Feature.LookupListIndex)

    for record in font["name"].names:
        if record.nameID in (1, 3, 4, 6, 16, 17):
            text = record.toUnicode().replace(FAMILY[0], FAMILY[1]).replace(POSTSCRIPT[0], POSTSCRIPT[1])
            record.string = text
    cff.fontNames = [n.replace(POSTSCRIPT[0], POSTSCRIPT[1]) for n in cff.fontNames]
    top.FullName = top.FullName.replace(FAMILY[0], FAMILY[1])
    if hasattr(top, "FamilyName"):
        top.FamilyName = top.FamilyName.replace(FAMILY[0], FAMILY[1])

    left = [r.toUnicode() for r in font["name"].names if r.nameID not in (0, 13, 14) and FAMILY[0] in r.toUnicode()]
    if left:
        sys.exit(f"the reserved name is still in the name table: {left}")

    font.flavor = "woff2"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"font: {len(ADDED) + len(MAPPED)} characters added, {OUT}")


main()
