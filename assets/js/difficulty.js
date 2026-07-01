/* =====================================================================
   difficulty.js — 本文の語数・語彙レベル・平均文長から難易度を算出する共有モジュール
   閲覧ページ(viewer.js)・設定ページ(settings.js)の両方から使用。
   依存: Markup(markup.js) / Corpus(corpus.js) / Store(store.js)

   難易度スコア = 語彙レベル(Oxford5000 のCEFR加重平均。内容語のみ、固有名詞除外、
   リスト外は最難相当=6) と 平均文長レベル(1〜6) を localStorage の重みで合成。
   難易度帯は登録済み「長文」大問の分布を四分位で区切った相対4段階。
   ===================================================================== */
(function (global) {
  "use strict";

  var LEVEL_WEIGHT = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  var OFFLIST_WEIGHT = 6;                 // リスト外の語は最難(C1超)相当
  var BAND_TH = [1.8, 2.5, 3.4];          // 四分位が作れないときの絶対フォールバック
  var BAND_LABEL = { "易": "易しめ", "標準": "標準", "難": "難しめ", "最難": "最難" };
  var SL_MIN = 12, SL_MAX = 34;           // 平均文長(語)→ 1〜6スケールの目安
  var SENT_ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|No|Vol|Fig|cf|ca|pp|Inc|Ltd|Co|Corp|Ave|Rd|Gen|Sen|Rev|Gov|Capt|Sgt|Lt|Col|Univ|approx)\b\./gi;

  // 難易度計算用リスト（Oxford5000 と内蔵ストップワード）を遅延キャッシュ
  var _lists = null;
  function lists() {
    if (!_lists) {
      _lists = {
        levelMap: (Store.builtinLevelList && Store.builtinLevelList()) ? Store.builtinLevelList().levels : {},
        stopSet: Corpus.toSet(Store.builtinStopList().words || [])
      };
    }
    return _lists;
  }

  // 難易度の重み（語彙 : 文長）。localStorage（この端末）に保存。既定 0.5。
  function weights() {
    var v = Store.getDifficultyVocabWeight();
    return { vocab: v, sentence: 1 - v };
  }

  // 英単語数（記法除去後にカウント。Corpus.tokenize と同じトークン定義）
  function wordCount(rawText) {
    var m = String(Markup.strip(rawText) || "").toLowerCase().match(/[a-z][a-z'’]*[a-z]|[a-z]/g);
    return m ? m.length : 0;
  }

  // 原文で「常に大文字始まり」かつ Oxford5000 外の語を固有名詞候補として集める
  function properNounSet(text, levelMap) {
    var seenLower = Object.create(null), capOnly = Object.create(null);
    var toks = Corpus.tokenizeWithCase(text);
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i], lw = w.toLowerCase();
      if (/^[A-Z]/.test(w)) { if (!(lw in seenLower)) capOnly[lw] = true; }
      else { seenLower[lw] = true; }
    }
    var pn = Object.create(null);
    Object.keys(capOnly).forEach(function (lw) {
      if (seenLower[lw]) return;                              // 小文字でも出現 → 一般語
      if (Corpus.resolveBase(lw, levelMap) !== null) return;  // リスト内 → 残す
      pn[lw] = true;
    });
    return pn;
  }

  // 記法除去済みテキストの内容語を CEFR 加重平均（リスト外=6 算入。0=判定不能）
  function strippedLevelAvg(text, levelMap, stopSet) {
    var pn = properNounSet(text, levelMap);
    var toks = Corpus.tokenize(text).filter(function (w) {
      return !(stopSet && stopSet[w]) && !pn[w];
    });
    if (!toks.length) return 0;
    var s = Corpus.levelStats(toks, levelMap);
    if (!s.tokenTotal) return 0;
    var sum = 0;
    s.perLevel.forEach(function (p) { sum += (LEVEL_WEIGHT[p.level] || 0) * p.tokens; });
    sum += OFFLIST_WEIGHT * s.tokenOff;
    return sum / s.tokenTotal;
  }

  // 文数のカウント（略語・小数・省略記号・閉じ引用符などを補正して過剰分割を防ぐ）
  function sentenceCount(text) {
    var t = String(text || "");
    if (!t.trim()) return 0;
    t = t.replace(/(\d)[.,](\d)/g, "$1$2");
    t = t.replace(/\.\.\.+|…/g, " ");
    t = t.replace(SENT_ABBR, " ");
    t = t.replace(/\b(?:e\.g|i\.e|a\.m|p\.m)\.?/gi, " ");
    t = t.replace(/\b([A-Za-z])\./g, "$1");
    var m = t.match(/[.!?]+["'”’)\]）」』]*(?=\s|$)/g);
    var n = m ? m.length : 0;
    return n > 0 ? n : 1;
  }
  // 記法除去済みテキストの平均文長（1文あたりの語数）
  function strippedAsl(text) {
    var words = Corpus.tokenize(text).length;
    if (!words) return 0;
    var sents = sentenceCount(text);
    return sents ? words / sents : 0;
  }
  // 平均文長 → CEFR と同じ 1〜6 スケールへ
  function slToLevel(asl) {
    if (!asl) return 0;
    return Math.max(1, Math.min(6, 1 + (asl - SL_MIN) / (SL_MAX - SL_MIN) * 5));
  }
  // 合成スコア（語彙レベルと文長レベルを重み付き平均。欠損側は在る方のみ）
  function compositeScore(vocab, asl, w) {
    var sl = slToLevel(asl);
    if (!vocab && !sl) return 0;
    if (!vocab) return sl;
    if (!sl) return vocab;
    return w.vocab * vocab + w.sentence * sl;
  }

  // 本文セクションの生テキスト → { score, vocab, asl }（w 省略時は現在の重み）
  function detailForText(rawText, w) {
    var stripped = Markup.strip(rawText);
    var L = lists();
    var vocab = strippedLevelAvg(stripped, L.levelMap, L.stopSet);
    var asl = strippedAsl(stripped);
    var score = compositeScore(vocab, asl, w || weights());
    return { score: score, vocab: vocab, asl: asl };
  }
  function scoreForText(rawText, w) { return detailForText(rawText, w).score; }

  // 加重平均値 → 難易度帯ラベル（cutoffs=四分位境界。無ければ絶対フォールバック。""=判定不能）
  function band(score, cutoffs) {
    if (!score) return "";
    var th = cutoffs || BAND_TH;
    if (score < th[0]) return "易";
    if (score < th[1]) return "標準";
    if (score < th[2]) return "難";
    return "最難";
  }

  // 問題オブジェクトの本文テキスト（{{本文}} が無ければ problem_text 全体）
  function bodyText(q) {
    var sections = Markup.parseSections(q.problem_text || "");
    var body = sections.filter(function (s) { return s.type === "本文"; });
    return body.length ? body.map(function (s) { return s.text; }).join("\n") : (q.problem_text || "");
  }

  // 登録済み「長文」大問群 → { byKey:{ "examId:qnum": {score,vocab,asl} }, cutoffs }
  function corpusLevels(questions, w) {
    w = w || weights();
    var byKey = Object.create(null), vals = [];
    (questions || []).forEach(function (q) {
      if ((q.category || "") !== "長文") return;
      var d = detailForText(bodyText(q), w);
      byKey[q.exam_id + ":" + q.question_number] = d;
      if (d.score) vals.push(d.score);
    });
    vals.sort(function (a, b) { return a - b; });
    var cutoffs = null;
    if (vals.length >= 4) {
      cutoffs = [
        vals[Math.floor(0.25 * (vals.length - 1))],
        vals[Math.floor(0.50 * (vals.length - 1))],
        vals[Math.floor(0.75 * (vals.length - 1))]
      ];
    }
    return { byKey: byKey, cutoffs: cutoffs };
  }

  global.Difficulty = {
    weights: weights,
    wordCount: wordCount,
    bodyText: bodyText,
    scoreForText: scoreForText,
    detailForText: detailForText,
    band: band,
    corpusLevels: corpusLevels,
    BAND_LABEL: BAND_LABEL
  };
})(window);
