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

  /* ---------------- 派生語の原形解決（軽量レンマタイザー） ----------------
     リスト照合用。完全一致しないトークンについて、規則変化（複数形 -s/-es、
     過去形 -ed、進行形 -ing、比較級 -er/-est、副詞 -ly など）と不規則変化
     （went→go, children→child など）から原形候補を生成し、リスト内に
     存在するものを採用する。 */
  var IRREGULAR = {
    // be / 助動詞・縮約形
    am: "be", is: "be", are: "be", was: "be", were: "be", been: "be", being: "be",
    has: "have", had: "have", does: "do", did: "do", done: "do",
    "isn't": "be", "aren't": "be", "wasn't": "be", "weren't": "be",
    "don't": "do", "doesn't": "do", "didn't": "do",
    "hasn't": "have", "haven't": "have", "hadn't": "have",
    "won't": "will", "can't": "can", "cannot": "can",
    // 不規則動詞（過去形・過去分詞）
    went: "go", gone: "go", goes: "go", said: "say", made: "make", got: "get", gotten: "get",
    knew: "know", known: "know", thought: "think", took: "take", taken: "take",
    saw: "see", seen: "see", came: "come", gave: "give", given: "give", found: "find",
    told: "tell", became: "become", left: "leave", felt: "feel", brought: "bring",
    began: "begin", begun: "begin", kept: "keep", held: "hold", wrote: "write",
    written: "write", stood: "stand", heard: "hear", meant: "mean", met: "meet",
    ran: "run", paid: "pay", sat: "sit", spoke: "speak", spoken: "speak",
    lay: "lie", lain: "lie", laid: "lay", led: "lead", grew: "grow", grown: "grow",
    lost: "lose", fell: "fall", fallen: "fall", sent: "send", built: "build",
    understood: "understand", drew: "draw", drawn: "draw", broke: "break",
    broken: "break", spent: "spend", rose: "rise", risen: "rise", drove: "drive",
    driven: "drive", bought: "buy", wore: "wear", worn: "wear", chose: "choose",
    chosen: "choose", sought: "seek", threw: "throw", thrown: "throw",
    caught: "catch", dealt: "deal", won: "win", forgot: "forget", forgotten: "forget",
    fought: "fight", taught: "teach", ate: "eat", eaten: "eat", sold: "sell",
    flew: "fly", flown: "fly", slept: "sleep", struck: "strike", hung: "hang",
    shook: "shake", shaken: "shake", rode: "ride", ridden: "ride", fed: "feed",
    swam: "swim", swum: "swim", sang: "sing", sung: "sing", drank: "drink",
    drunk: "drink", blew: "blow", blown: "blow", hid: "hide", hidden: "hide",
    shot: "shoot", bent: "bend", bit: "bite", bitten: "bite", beaten: "beat",
    froze: "freeze", frozen: "freeze", stole: "steal", stolen: "steal",
    swore: "swear", sworn: "swear", tore: "tear", torn: "tear", woke: "wake",
    woken: "wake", arose: "arise", arisen: "arise", bore: "bear", borne: "bear",
    born: "bear", burnt: "burn", learnt: "learn", lent: "lend", proven: "prove",
    mistook: "mistake", mistaken: "mistake",
    // 不規則複数形・学術語
    men: "man", women: "woman", children: "child", feet: "foot", teeth: "tooth",
    mice: "mouse", geese: "goose", oxen: "ox", criteria: "criterion",
    phenomena: "phenomenon", analyses: "analysis", theses: "thesis",
    hypotheses: "hypothesis", crises: "crisis", bacteria: "bacterium",
    // 比較級・最上級
    better: "good", best: "good", worse: "bad", worst: "bad",
    further: "far", farther: "far", elder: "old", eldest: "old"
  };

  // 原形候補を生成（生成順 = 優先順）
  function lemmaCandidates(w) {
    var out = [];
    function add(x) { if (x && x.length > 1 && x !== w && out.indexOf(x) < 0) out.push(x); }
    if (IRREGULAR[w]) add(IRREGULAR[w]);
    var n = w.length;
    // 縮約・所有格
    if (/n't$/.test(w)) add(w.slice(0, -3));
    if (/'(s|ll|re|ve|d|m)$/.test(w)) add(w.replace(/'(s|ll|re|ve|d|m)$/, ""));
    // 複数形・三単現
    if (/ies$/.test(w) && n > 4) add(w.slice(0, -3) + "y");
    if (/ves$/.test(w) && n > 4) { add(w.slice(0, -3) + "f"); add(w.slice(0, -3) + "fe"); }
    if (/(ses|xes|zes|ches|shes)$/.test(w)) add(w.slice(0, -2));
    if (/oes$/.test(w) && n > 3) add(w.slice(0, -2));
    if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) add(w.slice(0, -1));
    // 過去形
    if (/ied$/.test(w) && n > 4) add(w.slice(0, -3) + "y");
    if (/ed$/.test(w) && n > 3) {
      add(w.slice(0, -2));
      add(w.slice(0, -1)); // -e 動詞（changed→change）
      if (n > 4 && w[n - 3] === w[n - 4]) add(w.slice(0, -3)); // 子音重複（stopped→stop）
    }
    // 進行形
    if (/ing$/.test(w) && n > 5) {
      add(w.slice(0, -3));
      add(w.slice(0, -3) + "e"); // making→make
      if (n > 6 && w[n - 4] === w[n - 5]) add(w.slice(0, -4)); // running→run
    }
    // 比較級・最上級
    if (/ier$/.test(w) && n > 4) add(w.slice(0, -3) + "y");
    if (/iest$/.test(w) && n > 5) add(w.slice(0, -4) + "y");
    if (/er$/.test(w) && n > 4) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (n > 5 && w[n - 3] === w[n - 4]) add(w.slice(0, -3)); }
    if (/est$/.test(w) && n > 5) { add(w.slice(0, -3)); add(w.slice(0, -2)); if (n > 6 && w[n - 4] === w[n - 5]) add(w.slice(0, -4)); }
    // 副詞
    if (/ily$/.test(w) && n > 4) add(w.slice(0, -3) + "y");
    if (/ly$/.test(w) && n > 4) add(w.slice(0, -2));
    return out;
  }

  // map（語→任意の値）に対し、w 自身または原形候補のうち存在するキーを返す。
  // 不規則変化は候補からさらに一段だけ解決する（doesn't → does → do）。
  function resolveBase(w, map) {
    if (map[w] != null) return w;
    var cands = lemmaCandidates(w);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (map[c] != null) return c;
      var irr = IRREGULAR[c];
      if (irr && map[irr] != null) return irr;
    }
    return null;
  }

  // 語彙レベルカバー率。vocabSet = 語彙リストの語集合。
  // 表層形が語彙リストに完全一致するものを「見出し語」、原形解決で一致する
  // ものを「派生語」、いずれにも一致しないものを「その他（リスト外）」とする。
  function coverage(tokens, vocabSet) {
    var total = tokens.length;
    var headTok = 0, derivTok = 0;
    var types = Object.create(null), typesHead = Object.create(null), typesDeriv = Object.create(null);
    var offCounts = Object.create(null);
    var baseCache = Object.create(null); // 表層形→解決結果のメモ
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      types[w] = true;
      var base = (w in baseCache) ? baseCache[w] : (baseCache[w] = resolveBase(w, vocabSet));
      if (base === w) { headTok++; typesHead[w] = true; }
      else if (base !== null) { derivTok++; typesDeriv[w] = true; }
      else { offCounts[w] = (offCounts[w] || 0) + 1; }
    }
    var inList = headTok + derivTok;
    var typeCount = Object.keys(types).length;
    var typeHeadCount = Object.keys(typesHead).length;
    var typeDerivCount = Object.keys(typesDeriv).length;
    var typeInCount = typeHeadCount + typeDerivCount;
    var offList = Object.keys(offCounts).map(function (w) { return { word: w, count: offCounts[w] }; });
    offList.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    return {
      tokenTotal: total,
      tokenInList: inList,
      tokenHead: headTok,
      tokenDerived: derivTok,
      tokenCoverage: total ? (inList / total) : 0,
      tokenHeadCoverage: total ? (headTok / total) : 0,
      tokenDerivedCoverage: total ? (derivTok / total) : 0,
      typeTotal: typeCount,
      typeInList: typeInCount,
      typeHead: typeHeadCount,
      typeDerived: typeDerivCount,
      typeCoverage: typeCount ? (typeInCount / typeCount) : 0,
      offList: offList
    };
  }

  // レベル別語彙分析。levelMap = { word: "A1" | ... } の語→レベル写像。
  // 派生語（複数形・-ing 等）は原形に解決してレベルを引く。表示は表層形のまま。
  var LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
  function levelStats(tokens, levelMap) {
    var tokenByLevel = Object.create(null), wordsByLevel = Object.create(null);
    LEVEL_ORDER.forEach(function (l) { tokenByLevel[l] = 0; wordsByLevel[l] = Object.create(null); });
    var off = Object.create(null), tokenOff = 0;
    var baseCache = Object.create(null); // 表層形→解決済み原形（なければ null）
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      var base = (w in baseCache) ? baseCache[w] : (baseCache[w] = resolveBase(w, levelMap));
      var lv = base !== null ? levelMap[base] : null;
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
    lemmaCandidates: lemmaCandidates,
    resolveBase: resolveBase,
    LEVEL_ORDER: LEVEL_ORDER,
    stats: stats
  };
})(window);
