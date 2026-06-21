/* =====================================================================
   markup.js — 入試問題記法 → HTML
   既存 parser.tsx と同じ記法を踏襲:
     {{問N}}        … 大問見出しバッジ
     [[N]] [[A]]    … 空所バッジ
     ##語::訳##     … 脚注（語注）
     ==語== :色     … ハイライト（色: yellow/blue/red/purple/pink/green/aqua）
     __語__         … 下線
     **語**         … 太字
     ~~x~~          … 下付き
     ^^x^^          … 上付き
     ((A)) 本文      … 選択肢（行頭）
     !!!!出典!!!!    … 出典表記（右寄せ・グレー・小）
     ||||斜字||||    … 斜字（イタリック）
     ----           … 区切り線
     [1] [2]（行頭） … 段落先頭に置く段落番号バッジ（全セクションで有効。字下げは opts.paraNum=true のみ）
   ===================================================================== */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var VALID_COLORS = ["yellow", "blue", "red", "purple", "pink", "green", "aqua"];

  // 画像URLの基準（Worker のベースURL）。![alt](/api/image/KEY) のような相対参照を解決する。
  var imageBase = "";
  function resolveImg(u) {
    u = String(u || "").trim();
    if (/^(https?:|data:)/i.test(u)) return u;           // 絶対URL・データURLはそのまま
    var b = imageBase.replace(/\/+$/, "");
    return b + (u.charAt(0) === "/" ? u : "/" + u);       // 相対は imageBase を前置
  }

  // 「. 」の後を広げない略語（+ 単独の大文字イニシャル: J. K. Rowling など）
  var ABBREV = /^(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Jr|Sr|vs|etc|No|Vol|Fig|cf|ca|pp|[A-Z])$/;

  // ストレートクォート → スマートクォート変換
  function smartQuotes(s) {
    s = s.replace(/(^|[\s(\[{—])"/g, "$1“");  // opening "
    s = s.replace(/"/g, "”");                       // closing "
    s = s.replace(/(^|[\s(\[{—])'/g, "$1‘");  // opening '
    s = s.replace(/'/g, "’");                       // closing ' / apostrophe
    return s;
  }

  // インライン記法をHTMLへ。footnotes は配列で受け取り副作用で追加。
  function inline(text, footnotes) {
    var out = "";
    var rem = text;
    while (rem.length > 0) {
      var m;

      // [[N]] 空所
      // 左右の間隔はどちらもスペース文字で確保（行頭・行末ではブラウザが
      // スペースを消すため CSS マージンより自然に揃う）
      if ((m = rem.match(/^\[\[([^\]]+)\]\]/))) {
        if (out && !/[\s(\[{「『（【]$/.test(out)) out += " ";
        out += '<span class="blank-badge">' + esc(m[1]) + "</span>";
        rem = rem.slice(m[0].length);
        if (rem.length && !/^[\s.,;:!?\]）」』】。、！？]/.test(rem)) out += " ";
        continue;
      }
      // [N] 段落番号バッジ（行中。空所 [[ ]] とは別の単角括弧。[[ は上で処理済み）
      if ((m = rem.match(/^\[([^\[\]]+)\]/))) {
        out += '<span class="para-badge para-badge-inline">' + esc(m[1]) + "</span>";
        rem = rem.slice(m[0].length); continue;
      }
      // ##語::訳## 脚注
      if ((m = rem.match(/^##([^:#]+)::([^#]+)##/))) {
        var idx = footnotes.length + 1;
        footnotes.push({ index: idx, word: m[1], translation: m[2] });
        out += '<span title="' + esc(m[1] + ": " + m[2]) + '">' + esc(m[1]) +
               '<sup class="footnote-number">*' + idx + "</sup></span>";
        rem = rem.slice(m[0].length); continue;
      }
      // ![説明](URL) 画像（Markdown記法）
      if ((m = rem.match(/^!\[([^\]]*)\]\(([^)\s]+)\)/))) {
        out += '<img class="exam-img" src="' + esc(resolveImg(m[2])) + '" alt="' + esc(m[1]) +
               '"' + (m[1] ? ' title="' + esc(m[1]) + '"' : "") + ">";
        rem = rem.slice(m[0].length); continue;
      }
      // !!!!出典!!!!（右寄せ・グレー・小）
      if ((m = rem.match(/^!!!!([\s\S]+?)!!!!/))) {
        out += '<span class="cite">' + inline(m[1], footnotes) + "</span>";
        rem = rem.slice(m[0].length); continue;
      }
      // ||||斜字||||
      if ((m = rem.match(/^\|\|\|\|([\s\S]+?)\|\|\|\|/))) {
        out += "<em>" + inline(m[1], footnotes) + "</em>";
        rem = rem.slice(m[0].length); continue;
      }
      // ==語==:色
      if ((m = rem.match(/^==([^=]+)==:(\w+)/))) {
        var c = VALID_COLORS.indexOf(m[2]) >= 0 ? m[2] : "yellow";
        out += '<mark class="hl hl-' + c + '">' + inline(m[1], footnotes) + "</mark>";
        rem = rem.slice(m[0].length); continue;
      }
      // ==語==
      if ((m = rem.match(/^==([^=]+)==(?!:\w)/))) {
        out += '<mark class="hl hl-yellow">' + inline(m[1], footnotes) + "</mark>";
        rem = rem.slice(m[0].length); continue;
      }
      // __下線__
      if ((m = rem.match(/^__([^_]+)__/))) {
        out += "<u>" + inline(m[1], footnotes) + "</u>";
        rem = rem.slice(m[0].length); continue;
      }
      // ~~下付き~~
      if ((m = rem.match(/^~~([^~]+)~~/))) {
        out += "<sub>" + esc(m[1]) + "</sub>";
        rem = rem.slice(m[0].length); continue;
      }
      // ^^上付き^^
      if ((m = rem.match(/^\^\^([^^]+)\^\^/))) {
        out += "<sup>" + esc(m[1]) + "</sup>";
        rem = rem.slice(m[0].length); continue;
      }
      // **太字**
      if ((m = rem.match(/^\*\*([^*]+)\*\*/))) {
        out += "<strong>" + inline(m[1], footnotes) + "</strong>";
        rem = rem.slice(m[0].length); continue;
      }
      // {{問N}}（行中）
      if ((m = rem.match(/^\{\{([^}]+)\}\}/))) {
        out += '<span class="question-badge">' + esc(m[1]) + "</span>";
        rem = rem.slice(m[0].length); continue;
      }
      // ((A)) 選択肢ラベル（行中・インライン。丸囲みラベルのみ表示）
      if ((m = rem.match(/^\(\(([^)]+)\)\)/))) {
        out += '<span class="choice-inline">' + esc(m[1]) + "</span>";
        rem = rem.slice(m[0].length); continue;
      }

      // プレーンテキスト（次の記法開始まで）
      var end = 1;
      while (end < rem.length) {
        var ch = rem[end];
        if (ch === "[" || ch === "#" || ch === "=" || ch === "_" ||
            ch === "~" || ch === "^" || ch === "{" || ch === "(" || ch === "*" ||
            ch === "!" || ch === "|") break;
        end++;
      }
      var plain = esc(smartQuotes(rem.slice(0, end)));
      // 文末の . ? ! の直後に大文字が来る場合、スペースを2つ分に広げる
      // （. のときのみ Dr. / Mr. / Mt. などの略語・イニシャルは除外）
      plain = plain.replace(/([A-Za-z]*)([.?!]) (?=[A-Z])/g, function (full, w, p) {
        if (p === "." && ABBREV.test(w)) return full;
        return w + p + "&emsp;";
      });
      // em dash → 2em幅（隙間なし）
      plain = plain.replace(/—/g, '<span class="em-dash">——</span>');
      out += plain;
      rem = rem.slice(end);
    }
    return out;
  }

  // ---- Markdown 風テーブル ----
  // 区切り行か（パイプを含む `|---|:--:|` 等。本文の `----` と混同しないため
  // 必ずパイプを1つ以上含むことを条件にする）
  function isTableSep(line) {
    var t = line.trim();
    if (t.indexOf("|") < 0) return false;
    t = t.replace(/^\|/, "").replace(/\|$/, "");
    var cells = t.split("|");
    if (!cells.length) return false;
    return cells.every(function (c) { return /^\s*:?-+:?\s*$/.test(c); });
  }
  // 行をセル配列へ分割（`\|` はセル内のリテラルパイプとして扱う）
  function splitRow(line) {
    var t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    var cells = [], buf = "";
    for (var i = 0; i < t.length; i++) {
      if (t[i] === "\\" && t[i + 1] === "|") { buf += "|"; i++; continue; }
      if (t[i] === "|") { cells.push(buf.trim()); buf = ""; continue; }
      buf += t[i];
    }
    cells.push(buf.trim());
    return cells;
  }
  // lines[start] をヘッダ、lines[start+1] を区切り行とする表を描画。
  // 返り値 next は表の次に処理すべき行インデックス。
  function renderTable(lines, start, footnotes) {
    var headers = splitRow(lines[start]);
    var aligns = splitRow(lines[start + 1]).map(function (c) {
      var l = c.charAt(0) === ":", r = c.charAt(c.length - 1) === ":";
      return l && r ? "center" : r ? "right" : l ? "left" : "";
    });
    var bodies = [], idx = start + 2;
    for (; idx < lines.length; idx++) {
      var lt = lines[idx].trim();
      if (lt === "" || lt.indexOf("|") < 0) break;
      bodies.push(splitRow(lines[idx]));
    }
    function cell(tag, txt, al) {
      return "<" + tag + (al ? ' style="text-align:' + al + '"' : "") + ">" +
             inline(txt || "", footnotes) + "</" + tag + ">";
    }
    var h = '<div class="exam-table-wrap"><table class="exam-table"><thead><tr>';
    headers.forEach(function (c, ci) { h += cell("th", c, aligns[ci]); });
    h += "</tr></thead><tbody>";
    bodies.forEach(function (row) {
      h += "<tr>";
      for (var ci = 0; ci < headers.length; ci++) h += cell("td", row[ci] != null ? row[ci] : "", aligns[ci]);
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    return { html: h, next: idx };
  }

  // テキスト全体 → { html, footnotes }
  // 段落先頭の [1] [2] は全セクションで段落番号バッジに変換する。
  // opts.paraNum=true（本文・和訳セクション）のときは、さらにバッジの無い段落先頭に字下げを付ける。
  function render(text, opts) {
    var paraNum = opts && opts.paraNum;
    var footnotes = [];
    var lines = String(text == null ? "" : text).split("\n");
    var html = "";
    var paraStart = true; // 段落先頭か（空行・見出し・選択肢・区切りの直後）

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (trimmed === "") { html += '<div style="height:.6em"></div>'; paraStart = true; continue; }
      if (trimmed === "----") { html += '<hr class="exam-hr">'; paraStart = true; continue; }

      // Markdown 風テーブル（ヘッダ行 + 区切り行 |---|---| が続く場合）
      if (trimmed.indexOf("|") >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var tbl = renderTable(lines, i, footnotes);
        html += tbl.html;
        i = tbl.next - 1; // for ループの ++ で次行へ
        paraStart = true;
        continue;
      }

      // {{問N}} 行頭 → 見出し
      var qm = trimmed.match(/^\{\{([^}]+)\}\}/);
      if (qm) {
        var rest = trimmed.slice(qm[0].length).trim();
        html += '<div class="question-block-header"><span class="question-badge">' +
                esc(qm[1]) + "</span>" +
                (rest ? '<span class="qtext">' + inline(rest, footnotes) + "</span>" : "") +
                "</div>";
        paraStart = true;
        continue;
      }

      // ((A)) 本文 → 選択肢（行頭）。ただし 1行に (()) が複数ある場合は
      // ブロック化せず通常行として描画し、先頭も含めて全てインライン丸ラベルにする。
      var cm = line.match(/^\s*\(\(([^)]+)\)\)\s*([\s\S]*)/);
      var choiceCount = (line.match(/\(\([^)]+\)\)/g) || []).length;
      if (cm && choiceCount === 1) {
        html += '<div class="answer-choice"><span class="answer-choice-label">' + esc(cm[1]) +
                '</span><span class="answer-choice-text">' +
                (cm[2] ? inline(cm[2], footnotes) : "") + "</span></div>";
        paraStart = true;
        continue;
      }

      // 段落先頭の [1] [2]（単角括弧。空所 [[ ]] とは別）を段落番号バッジに（全セクションで有効）
      var badgeNum = "";
      if (paraStart) {
        var pm = trimmed.match(/^\[([^\[\]]+)\]\s?/);
        if (pm) {
          badgeNum = pm[1];
          line = line.replace(/^\s*\[[^\[\]]+\]\s?/, "");
          trimmed = line.trim();
        }
      }
      // @@ 行頭タグ → 強制字下げなし（indent 抑制）
      var noIndent = false;
      if (/^\s*@@/.test(line)) {
        noIndent = true;
        line = line.replace(/^\s*@@\s?/, "");
        trimmed = line.trim();
      }
      // 字下げ：本文・和訳ではバッジの無い段落先頭を字下げ。それ以外は英語大文字始まりのみ。
      var indent = !noIndent && paraStart && (paraNum ? !badgeNum : /^[A-Z]/.test(trimmed));
      var prefix = badgeNum ? '<span class="para-badge">' + esc(badgeNum) + "</span>" : "";
      html += '<span class="blk' + (indent ? " indent" : "") + '">' + prefix + inline(line, footnotes) + "</span>";
      paraStart = false;
    }

    if (footnotes.length) {
      html += '<div class="footnote-section"><ol>';
      footnotes.forEach(function (fn) {
        html += '<li><span class="footnote-number">*' + fn.index + "</span><span><strong>" +
                esc(fn.word) + "</strong>: " + esc(fn.translation) + "</span></li>";
      });
      html += "</ol></div>";
    }
    return { html: html, footnotes: footnotes };
  }

  // 英文抽出用: 記法を取り除いてプレーン英文テキストにする（コーパス分析の前処理）
  function strip(text) {
    var t = String(text == null ? "" : text);
    t = t.replace(/\{\{[^}]*\}\}/g, " ");           // 問見出し
    t = t.replace(/\[\[[^\]]*\]\]/g, " ");          // 空所
    t = t.replace(/^\s*\[[^\[\]]+\]\s?/gm, "");     // 段落番号 [1]（行頭・単角括弧）
    t = t.replace(/##([^:#]+)::[^#]+##/g, "$1");    // 脚注 → 語のみ残す
    t = t.replace(/!\[[^\]]*\]\([^)\s]+\)/g, " ");   // 画像 → 除去
    t = t.replace(/!!!!([\s\S]+?)!!!!/g, " ");      // 出典 → 除去
    t = t.replace(/\|\|\|\|([\s\S]+?)\|\|\|\|/g, "$1"); // 斜字 → テキスト残す
    t = t.replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/gm, " "); // 表の区切り行
    t = t.replace(/\|/g, " ");                          // 表のセル区切り → 空白
    t = t.replace(/==([^=]+)==:\w+/g, "$1");        // 色ハイライト
    t = t.replace(/==([^=]+)==/g, "$1");            // ハイライト
    t = t.replace(/__([^_]+)__/g, "$1");            // 下線
    t = t.replace(/\*\*([^*]+)\*\*/g, "$1");       // 太字
    t = t.replace(/~~([^~]+)~~/g, "$1");            // 下付き
    t = t.replace(/\^\^([^^]+)\^\^/g, "$1");        // 上付き
    t = t.replace(/\(\(([^)]+)\)\)/g, " ");         // 選択肢ラベル
    t = t.replace(/^@@\s?/gm, "");                  // @@ 字下げ抑制タグ
    t = t.replace(/----/g, " ");
    return t;
  }

  // problem_text を section 境界で分割。collectReg が追加した {{セクション名}} 行を検出。
  // ASCII 英数字を含むバッジ（{{問1}} など）は問題番号として無視する。
  function parseSections(text) {
    var sections = [];
    var lines = (text || "").split("\n");
    var curType = "問題", curLines = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].trim().match(/^\{\{([^0-9A-Za-z}]+)\}\}$/);
      if (m) {
        var t = curLines.join("\n").trim();
        if (t) sections.push({ type: curType, text: t });
        curType = m[1]; curLines = [];
      } else {
        curLines.push(lines[i]);
      }
    }
    var last = curLines.join("\n").trim();
    if (last || !sections.length) sections.push({ type: curType, text: last });
    return sections;
  }

  function setImageBase(b) { imageBase = String(b || ""); }
  global.Markup = { render: render, strip: strip, escape: esc, parseSections: parseSections, setImageBase: setImageBase };
})(window);
