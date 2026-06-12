/* =====================================================================
   corpus.js — 英語コーパス分析エンジン
   機能: トークン化 / 頻度リスト / KWICコンコーダンス /
         n-gram(連語) / 語彙レベルカバー率 / 語数・難易度統計
   ===================================================================== */
(function (global) {
  "use strict";

  // 英単語トークン（アポストロフィ内包を許容）を抽出して小文字化
  function tokenize(text) {
    var m = String(text || "").toLowerCase().match(/[a-z][a-z'’]*[a-z]|[a-z]/g);
    return m ? m.map(function (w) { return w.replace(/[’]/g, "'"); }) : [];
  }

  // 原文（大文字保持）トークンを位置付きで取得（KWIC用）
  function tokenizeWithCase(text) {
    var re = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g, m, arr = [];
    while ((m = re.exec(String(text || "")))) arr.push(m[0]);
    return arr;
  }

  function toSet(words) {
    var s = Object.create(null);
    (words || []).forEach(function (w) {
      w = String(w).toLowerCase().trim();
      if (w) s[w] = true;
    });
    return s;
  }

  // 頻度リスト: [{word, count}] 降順。stopSet で除外。
  function frequency(tokens, stopSet) {
    var counts = Object.create(null);
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      if (stopSet && stopSet[w]) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
    var arr = Object.keys(counts).map(function (w) { return { word: w, count: counts[w] }; });
    arr.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    return arr;
  }

  // n-gram: [{gram, count}] 降順。stopSet 指定時は構成語にストップワードを含むものを除外。
  function ngrams(tokens, n, stopSet) {
    var counts = Object.create(null);
    for (var i = 0; i + n <= tokens.length; i++) {
      var slice = tokens.slice(i, i + n);
      if (stopSet) {
        var skip = false;
        for (var j = 0; j < slice.length; j++) { if (stopSet[slice[j]]) { skip = true; break; } }
        if (skip) continue;
      }
      var g = slice.join(" ");
      counts[g] = (counts[g] || 0) + 1;
    }
    var arr = Object.keys(counts).map(function (g) { return { gram: g, count: counts[g] }; });
    arr.sort(function (a, b) { return b.count - a.count || (a.gram < b.gram ? -1 : 1); });
    return arr.filter(function (x) { return x.count > 1; });
  }

  // KWIC: 検索語の前後文脈。docs = [{text, label}]。windowSize = 片側語数。
  function kwic(docs, target, windowSize) {
    windowSize = windowSize || 7;
    var lc = String(target || "").toLowerCase().trim();
    var lines = [];
    if (!lc) return lines;
    (docs || []).forEach(function (doc) {
      var toks = tokenizeWithCase(doc.text);
      for (var i = 0; i < toks.length; i++) {
        if (toks[i].toLowerCase() === lc) {
          lines.push({
            left:  toks.slice(Math.max(0, i - windowSize), i).join(" "),
            key:   toks[i],
            right: toks.slice(i + 1, i + 1 + windowSize).join(" "),
            label: doc.label || ""
          });
        }
      }
    });
    return lines;
  }

  // 語彙レベルカバー率。vocabSet = 語彙リストの語集合。
  function coverage(tokens, vocabSet) {
    var total = tokens.length;
    var inList = 0;
    var types = Object.create(null), typesIn = Object.create(null);
    var offCounts = Object.create(null);
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      types[w] = true;
      if (vocabSet[w]) { inList++; typesIn[w] = true; }
      else { offCounts[w] = (offCounts[w] || 0) + 1; }
    }
    var typeCount = Object.keys(types).length;
    var typeInCount = Object.keys(typesIn).length;
    var offList = Object.keys(offCounts).map(function (w) { return { word: w, count: offCounts[w] }; });
    offList.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    return {
      tokenTotal: total,
      tokenInList: inList,
      tokenCoverage: total ? (inList / total) : 0,
      typeTotal: typeCount,
      typeInList: typeInCount,
      typeCoverage: typeCount ? (typeInCount / typeCount) : 0,
      offList: offList
    };
  }

  // レベル別語彙分析。levelMap = { word: "A1" | ... } の語→レベル写像。
  // 延べ語(token)・異なり語(type)をレベルごとに集計し、各レベルの語頻度も返す。
  var LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
  function levelStats(tokens, levelMap) {
    var tokenByLevel = Object.create(null), wordsByLevel = Object.create(null);
    LEVEL_ORDER.forEach(function (l) { tokenByLevel[l] = 0; wordsByLevel[l] = Object.create(null); });
    var off = Object.create(null), tokenOff = 0;
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      var lv = levelMap ? levelMap[w] : null;
      if (lv && tokenByLevel[lv] != null) {
        tokenByLevel[lv]++;
        wordsByLevel[lv][w] = (wordsByLevel[lv][w] || 0) + 1;
      } else {
        tokenOff++; off[w] = (off[w] || 0) + 1;
      }
    }
    var perLevel = LEVEL_ORDER.map(function (l) {
      var arr = Object.keys(wordsByLevel[l]).map(function (w) { return { word: w, count: wordsByLevel[l][w] }; });
      arr.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
      return { level: l, tokens: tokenByLevel[l], types: arr.length, words: arr };
    });
    var offArr = Object.keys(off).map(function (w) { return { word: w, count: off[w] }; });
    offArr.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    var inLevelTokens = tokens.length - tokenOff;
    return {
      order: LEVEL_ORDER.slice(),
      perLevel: perLevel,
      tokenTotal: tokens.length,
      tokenInLevel: inLevelTokens,
      tokenOff: tokenOff,
      offTypes: offArr.length,
      off: offArr
    };
  }

  // 語数・難易度統計
  function stats(text, tokens) {
    var types = Object.create(null);
    var charLen = 0;
    for (var i = 0; i < tokens.length; i++) { types[tokens[i]] = true; charLen += tokens[i].length; }
    var typeCount = Object.keys(types).length;
    var sentences = String(text || "").split(/[.!?]+[\s"'”’)]*/).filter(function (s) { return s.trim().length > 0; });
    var sentCount = sentences.length || (tokens.length ? 1 : 0);
    return {
      tokens: tokens.length,
      types: typeCount,
      ttr: tokens.length ? (typeCount / tokens.length) : 0,
      sentences: sentCount,
      avgSentenceLen: sentCount ? (tokens.length / sentCount) : 0,
      avgWordLen: tokens.length ? (charLen / tokens.length) : 0
    };
  }

  global.Corpus = {
    tokenize: tokenize,
    tokenizeWithCase: tokenizeWithCase,
    toSet: toSet,
    frequency: frequency,
    ngrams: ngrams,
    kwic: kwic,
    coverage: coverage,
    levelStats: levelStats,
    LEVEL_ORDER: LEVEL_ORDER,
    stats: stats
  };
})(window);
