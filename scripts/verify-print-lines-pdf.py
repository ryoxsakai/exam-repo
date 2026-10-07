"""Check visible PDF line numbers, their baselines, and unchanged body geometry."""
import json
import re
import sys
from pathlib import Path

import fitz

BODY_LEFT = 69 * .75  # Chromium's original @page 18mm margin rounds to 69 CSS px.
BODY_WIDTH = 174 * 72 / 25.4
TOKEN = re.compile(r"([ab])([12]1)\d{4}river")


def inspect(filename, numbered):
    doc = fitz.open(filename)
    words = []
    lines = {}
    numbers = []
    for page_index, page in enumerate(doc):
        for word in page.get_text("words"):
            if word[2] < BODY_LEFT - 1 and word[4].isdigit():
                continue
            words.append([page_index, word[4], *word[:4]])
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    text = span["text"].strip()
                    x0, y0, x1, y1 = span["bbox"]
                    baseline = span["origin"][1]
                    if text.isdigit() and x1 < BODY_LEFT - 1:
                        assert numbered, "OFF PDF has a line number"
                        assert x0 > 0, "Number is clipped at the page boundary"
                        assert abs(x1 - (BODY_LEFT - span["size"] / .72 * .45)) < .5, "Number changed its horizontal gap"
                        pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=fitz.Rect(x0-1, y0-1, x1+1, y1+1), colorspace=fitz.csGRAY)
                        assert sum(value < 160 for value in pix.samples) >= 5, "Number text exists but its rendered glyph is missing"
                        numbers.append({"page": page_index, "value": int(text), "baseline": baseline, "bbox": span["bbox"]})
                    for match in TOKEN.finditer(text):
                        key = match[1] + match[2]
                        rows = lines.setdefault(key, [])
                        if not any(row[0] == page_index and abs(row[1] - baseline) < .5 for row in rows):
                            rows.append([page_index, baseline])
                        assert x0 >= BODY_LEFT - .2 and x1 <= BODY_LEFT + BODY_WIDTH + .5, "Passage escaped its original body width"
    expected = []
    for key, rows in lines.items():
        rows.sort()
        for index, (page, baseline) in enumerate(rows, 1):
            if index % 5 == 0:
                expected.append({"key": key, "page": page, "value": index, "baseline": baseline})
    if numbered:
        assert expected and len(numbers) == len(expected), f"Number count differs: {len(numbers)} vs {len(expected)}"
        for row in expected:
            hits = [n for n in numbers if n["page"] == row["page"] and n["value"] == row["value"] and abs(n["baseline"] - row["baseline"]) < .6]
            assert len(hits) == 1, f"Missing, duplicated or misplaced number: {row}"
        # Evidence shows actual glyphs and continuation pages, not merely extracted digits.
        shown = sorted(set(n["page"] for n in numbers))
        for page_index in [shown[0], shown[-1]]:
            doc[page_index].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(str(Path(filename).with_suffix("")) + f"-page-{page_index+1}.png")
    words.sort(key=lambda w: (w[0], round(w[3], 1), round(w[2], 1), w[1]))
    return {"pages": len(doc), "words": words, "lines": lines, "numbers": numbers}


def compare(before, after):
    assert before["pages"] == after["pages"], "Page count changed"
    assert len(before["words"]) == len(after["words"]), "Printable text changed"
    for a, b in zip(before["words"], after["words"]):
        assert a[:2] == b[:2], f"Text order changed: {a} vs {b}"
        assert all(abs(x-y) < .3 for x, y in zip(a[2:], b[2:])), f"Body position/wrapping changed: {a} vs {b}"


if __name__ == "__main__":
    off = inspect(sys.argv[1], False)
    on = inspect(sys.argv[2], True)
    compare(off, on)
    if len(sys.argv) > 3:
        compare(inspect(sys.argv[3], False), off)
    report = {"pages": on["pages"], "body_lines": {k: len(v) for k, v in on["lines"].items()}, "number_count": len(on["numbers"]), "number_pages": sorted(set(n["page"]+1 for n in on["numbers"])), "geometry_unchanged": True}
    Path(sys.argv[2]).with_suffix(".json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
