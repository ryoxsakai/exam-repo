/* =====================================================================
   markup.js — 入試問題記法 → HTML
   既存 parser.tsx と同じ記法を踏襲:
     {{問N}}        … 大問見出しバッジ
     [[N]] [[A]]    … 空所バッジ
     ##語::訳##     … 脚注（語注）
     ==語== :色     … ハイライト（色: yellow/blue/red/purple/pink/green/aqua）
     __語__         … 下線
     ~~x~~          … 下付き
     ^^x^^          … 上付き
     ((A)) 本文      … 選択肢（行頭）
     ----           … 区切り線
   ===================================================================== */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var VALID_COLORS = ["yellow", "blue", "red", "purple", "pink", "green", "aqua"];

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
      if ((m = rem.match(/^\[\[([^\]]+)\]\]/))) {
        out += '<span class="blank-badge">' + esc(m[1]) + "</span>";
        rem = rem.slice(m[0].length); continue;
      }
      // ##語::訳## 脚注
      if ((m = rem.match(/^##([^:]+)::([^#]+)##/))) {
        var idx = footnotes.length + 1;
        footnotes.push({ index: idx, word: m[1], translation: m[2] });
        out += '<span title="' + esc(m[1] + ": " + m[2]) + '">' + esc(m[1]) +
               '<sup class="footnote-number">*' + idx + "</sup></span>";
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
      // {{問N}}（行中）
      if ((m = rem.match(/^\{\{([^}]+)\}\}/))) {
        out += '<span class="question-badge">' + esc(m[1]) + "</span>";
        rem = rem.slice(m[0].length); continue;
      }

      // プレーンテキスト（次の記法開始まで）
      var end = 1;
      while (end < rem.length) {
        var ch = rem[end];
        if (ch === "[" || ch === "#" || ch === "=" || ch === "_" ||
            ch === "~" || ch === "^" || ch === "{") break;
        end++;
      }
      var plain = esc(smartQuotes(rem.slice(0, end)));
      // ピリオドの直後に大文字が来る場合、スペースを2つ分に広げる
      plain = plain.replace(/\. ([A-Z])/g, ".&emsp;$1");
      // em dash → 2em幅（隙間なし）
      plain = plain.replace(/—/g, '<span class="em-dash">——</span>');
      out += plain;
      rem = rem.slice(end);
    }
    return out;
  }

  // テキスト全体 → { html, footnotes }
  function render(text) {
    var footnotes = [];
    var lines = String(text == null ? "" : text).split("\n");
    var html = "";
    var paraStart = true; // 段落先頭か（空行・見出し・選択肢・区切りの直後）

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (trimmed === "") { html += '<div style="height:.6em"></div>'; paraStart = true; continue; }
      if (trimmed === "----") { html += '<hr class="exam-hr">'; paraStart = true; continue; }

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

      // ((A)) 本文 → 選択肢
      var cm = line.match(/^\s*\(\(([^)]+)\)\)\s*([\s\S]*)/);
      if (cm) {
        html += '<div class="answer-choice"><span class="answer-choice-label">' + esc(cm[1]) +
                '</span><span class="answer-choice-text">' +
                (cm[2] ? inline(cm[2], footnotes) : "") + "</span></div>";
        paraStart = true;
        continue;
      }

      // 段落先頭かつ英語大文字で始まる行のみ字下げ
      var indent = paraStart && /^[A-Z]/.test(trimmed);
      html += '<span class="blk' + (indent ? " indent" : "") + '">' + inline(line, footnotes) + "</span>";
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
    t = t.replace(/##([^:]+)::[^#]+##/g, "$1");     // 脚注 → 語のみ残す
    t = t.replace(/==([^=]+)==:\w+/g, "$1");        // 色ハイライト
    t = t.replace(/==([^=]+)==/g, "$1");            // ハイライト
    t = t.replace(/__([^_]+)__/g, "$1");            // 下線
    t = t.replace(/~~([^~]+)~~/g, "$1");            // 下付き
    t = t.replace(/\^\^([^^]+)\^\^/g, "$1");        // 上付き
    t = t.replace(/\(\(([^)]+)\)\)/g, " ");         // 選択肢ラベル
    t = t.replace(/----/g, " ");
    return t;
  }

  global.Markup = { render: render, strip: strip, escape: esc };
})(window);
