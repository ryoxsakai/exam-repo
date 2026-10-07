"""Match named question and numeric blank badges in a PDF to the checked DOM."""
import json
import re
import sys
from pathlib import Path
import fitz

pdf_path, expected_path = sys.argv[1:3]
expected = json.loads(Path(expected_path).read_text())
rgb = list(map(int, re.findall(r"\d+", expected["color"])[:3]))
color = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
doc = fitz.open(pdf_path)
badges = []
blanks = []
pages = set()
for page_index, page in enumerate(doc):
    assert abs(page.rect.width - 595.28) < 1 and abs(page.rect.height - 841.89) < 1
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            # Chromium may encode CJK glyphs in a Type3 span with color=0.
            # The adjacent numeric glyph still identifies the badge's print color.
            text = "".join(s["text"] for s in line["spans"]).strip()
            if re.fullmatch(r"問\d+", text) and any(s["color"] == color for s in line["spans"]):
                badges.append(text)
                pages.add(page_index)
            for span in line["spans"]:
                value = span["text"].replace("\u200b", "").strip()
                if (re.fullmatch(r"\d+", value) and span["color"] == 0
                        and re.match(r"(?:Arial|Helvetica|LiberationSans)", span["font"])
                        and any(abs(span["size"] - b["size"]) < .1 for b in expected.get("blanks", []))):
                    blanks.append(value)
assert badges == expected["badges"], f"PDF badges differ: {badges} vs {expected['badges']}"
if "blanks" in expected:
    assert blanks == [b["text"] for b in expected["blanks"]], f"PDF blanks differ: {blanks} vs {expected['blanks']}"
for index in sorted(pages)[:2]:
    doc[index].get_pixmap(matrix=fitz.Matrix(1.2, 1.2)).save(str(Path(pdf_path).with_suffix("")) + f"-page-{index+1}.png")
report = {"pages": len(doc), "named_badges": badges, "blank_badges": blanks, "dom_order_matches_pdf": True}
Path(expected_path).write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({"pages": len(doc), "named_badges": len(badges), "blank_badges": len(blanks), "dom_order_matches_pdf": True}))
