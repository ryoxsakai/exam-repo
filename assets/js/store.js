/* =====================================================================
   store.js — localStorage 設定の集中管理
   ===================================================================== */
(function (global) {
  "use strict";

  var KEYS = {
    workerUrl:     "cf_worker_url",          // Worker API のベースURL
    anthropicKey:  "anthropic_api_key",      // PDF取り込み用 Anthropic APIキー（この端末のみ）
    siteTitle:     "exam_site_title",        // サイトタイトル
    siteSubtitle:  "exam_site_subtitle",     // サブタイトル
    customDomain:  "exam_custom_domain",     // 独自ドメイン（リンク生成用）
    tabLabels:     "exam_tab_labels",        // タブ表示名 {main:{id:名}, setting:{id:名}}
    tabOrderMain:  "exam_taborder_main",     // 閲覧ページのタブ順
    tabOrderSet:   "exam_taborder_setting",  // 設定ページのタブ順
    lastTabSet:    "exam_lasttab_setting",   // 設定ページで最後に開いたタブ
    lastTabMain:   "exam_lasttab_main",      // 閲覧ページで最後に開いたタブ
    stopwords:     "exam_stopword_lists",    // ストップワードリスト [{name,words[]}]
    vocab:         "exam_vocab_lists",       // 語彙リスト [{name,words[]}]
    wlCache:       "exam_wordlist_cache",    // Worker 保存リストのキャッシュ {stop:[...],level:[...]}
    sectionTypes:  "exam_section_types",     // 問題登録のプルダウン候補（問題/解答/解説…）
    fontSize:      "exam_fontsize",          // 問題閲覧モーダルの文字サイズ (sm/md/lg)
    printFontSize: "exam_print_fontsize",    // 問題印刷の文字サイズ（表紙以外。xs/sm/md/lg/xl）
    printLineHeight: "exam_print_lineheight", // 問題印刷の行間（表紙以外。1〜5）
    regDraft:      "exam_reg_draft",         // 問題登録フォームの下書き（リロードしても保持）
    printSections: "exam_print_sections",    // 印刷対象セクション {種別: bool}（全問題で共有）
    replaceRules:  "exam_replace_rules",     // 登録データ一括置換のルール [{from,to,regex}]
    difficultyVocabWeight: "exam_difficulty_vocab_weight" // 長文難易度の語彙:文長の重み(0〜1、この端末のみ)
  };

  function read(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      if (v === null || v === undefined) return fallback;
      return JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function readRaw(key, fallback) {
    var v = localStorage.getItem(key);
    return (v === null || v === undefined) ? fallback : v;
  }

  /* ---- 既定値 ---- */
  var DEFAULT_SECTION_TYPES = ["問題", "本文", "設問", "解答", "解説", "全訳"];

  // 汎用英語ストップワード（簡易）
  var DEFAULT_STOPWORDS = [
    "the","a","an","and","or","but","if","of","to","in","on","at","by","for","with",
    "about","as","into","like","through","after","over","between","out","against",
    "during","without","before","under","around","among","is","are","was","were","be",
    "been","being","have","has","had","do","does","did","will","would","shall","should",
    "can","could","may","might","must","this","that","these","those","i","you","he","she",
    "it","we","they","them","his","her","its","their","our","your","my","me","him","us",
    "who","whom","which","what","when","where","why","how","not","no","nor","so","than",
    "too","very","just","then","there","here","up","down","off","s","t","don","now"
  ];

  var Store = {
    KEYS: KEYS,

    /* Worker URL */
    getWorkerUrl: function () {
      var u = (readRaw(KEYS.workerUrl, "") || "").trim().replace(/\/$/, "");
      if (!u) u = "https://medical-exam-worker.ryoxsakai.workers.dev";
      if (!/^https?:\/\//.test(u)) u = "https://" + u;
      return u;
    },
    setWorkerUrl: function (url) { localStorage.setItem(KEYS.workerUrl, (url || "").trim()); },

    /* Anthropic API キー（PDF取り込み用。この端末の localStorage のみに保存） */
    getAnthropicKey: function () { return (readRaw(KEYS.anthropicKey, "") || "").trim(); },
    setAnthropicKey: function (k) { localStorage.setItem(KEYS.anthropicKey, (k || "").trim()); },

    /* サイトタイトル */
    getSiteTitle: function (fallback) { return readRaw(KEYS.siteTitle, fallback || "入試問題データベース"); },
    setSiteTitle: function (t) { localStorage.setItem(KEYS.siteTitle, t || ""); },

    /* サブタイトル */
    getSiteSubtitle: function (fallback) { return readRaw(KEYS.siteSubtitle, fallback || "Entrance Exam Database"); },
    setSiteSubtitle: function (t) { localStorage.setItem(KEYS.siteSubtitle, t || ""); },

    /* タブ表示名（カスタム名。未設定なら既定ラベル） */
    getTabLabel: function (page, id, fallback) {
      var all = read(KEYS.tabLabels, {}) || {};
      var pageMap = all[page] || {};
      var v = pageMap[id];
      return (typeof v === "string" && v.trim()) ? v.trim() : fallback;
    },
    setTabLabel: function (page, id, name) {
      var all = read(KEYS.tabLabels, {}) || {};
      if (!all[page]) all[page] = {};
      all[page][id] = (name || "").trim();
      write(KEYS.tabLabels, all);
    },

    /* 独自ドメイン */
    getCustomDomain: function () { return (readRaw(KEYS.customDomain, "") || "").trim(); },
    setCustomDomain: function (d) { localStorage.setItem(KEYS.customDomain, (d || "").trim()); },
    // リンク生成用ベースURL（"https://domain"）。未設定なら空文字。
    getBaseUrl: function () {
      var d = this.getCustomDomain();
      if (!d) return "";
      d = d.replace(/\/$/, "");
      if (!/^https?:\/\//.test(d)) d = "https://" + d;
      return d;
    },

    /* タブ順 */
    getTabOrder: function (page, defOrder) {
      var key = page === "setting" ? KEYS.tabOrderSet : KEYS.tabOrderMain;
      var saved = read(key, null);
      if (!Array.isArray(saved)) return defOrder.slice();
      // 既定に存在するものだけ + 新規を後ろに
      var valid = saved.filter(function (id) { return defOrder.indexOf(id) >= 0; });
      defOrder.forEach(function (id) { if (valid.indexOf(id) < 0) valid.push(id); });
      return valid;
    },
    setTabOrder: function (page, order) {
      write(page === "setting" ? KEYS.tabOrderSet : KEYS.tabOrderMain, order);
    },

    /* 最後に開いたタブ */
    getLastTab: function (page) { return readRaw(page === "setting" ? KEYS.lastTabSet : KEYS.lastTabMain, null); },
    setLastTab: function (page, id) { localStorage.setItem(page === "setting" ? KEYS.lastTabSet : KEYS.lastTabMain, id); },

    /* ストップワードリスト */
    getStopwordLists: function () {
      var lists = read(KEYS.stopwords, null);
      if (!Array.isArray(lists)) {
        lists = [{ name: "汎用英語ストップワード", words: DEFAULT_STOPWORDS.slice() }];
        write(KEYS.stopwords, lists);
      }
      return lists;
    },
    setStopwordLists: function (lists) { write(KEYS.stopwords, lists); },

    /* 語彙リスト（内蔵 Target1900 + localStorage。UI 表示順は内蔵が先頭） */
    builtinVocabList: function () {
      var t = global.TARGET1900;
      if (!t) return null;
      return { id: "builtin-target1900", name: (t.name || "Target 1900") + "（内蔵）", builtin: true, words: (t.words || []).slice() };
    },
    getVocabLists: function () {
      var bl = this.builtinVocabList();
      var out = bl ? [bl] : [];
      var lists = read(KEYS.vocab, null);
      if (!Array.isArray(lists)) { lists = []; write(KEYS.vocab, lists); }
      lists.forEach(function (l) { out.push({ name: l.name, words: Array.isArray(l.words) ? l.words : [] }); });
      return out;
    },
    setVocabLists: function (lists) { write(KEYS.vocab, lists); },

    /* ===== Worker 保存リスト（ストップワード=stop / レベル別語彙=level） ===== */
    // Worker から取得した生の行 [{id,type,name,data}] をローカルにキャッシュ。
    getWLCache: function (type) {
      var all = read(KEYS.wlCache, {}) || {};
      return Array.isArray(all[type]) ? all[type] : [];
    },
    setWLCache: function (type, lists) {
      var all = read(KEYS.wlCache, {}) || {};
      all[type] = lists || [];
      write(KEYS.wlCache, all);
    },
    // 内蔵リスト（DBに保存せず常に利用可能）
    builtinStopList: function () {
      return { id: "builtin-stop", name: "汎用英語ストップワード（内蔵）", type: "stop", builtin: true, words: DEFAULT_STOPWORDS.slice() };
    },
    builtinLevelList: function () {
      var o = global.OXFORD5000;
      if (!o) return null;
      return { id: "builtin-oxford", name: (o.name || "Oxford 5000") + "（内蔵）", type: "level", builtin: true, levels: o.levels || {} };
    },
    // 内蔵 + Worker キャッシュをマージして返す（UI 表示順は内蔵が先頭）
    getStopLists: function () {
      var out = [this.builtinStopList()];
      this.getWLCache("stop").forEach(function (l) {
        out.push({ id: l.id, name: l.name, type: "stop", words: Array.isArray(l.data) ? l.data : [] });
      });
      return out;
    },
    getLevelLists: function () {
      var bl = this.builtinLevelList();
      var out = bl ? [bl] : [];
      this.getWLCache("level").forEach(function (l) {
        out.push({ id: l.id, name: l.name, type: "level", levels: (l.data && typeof l.data === "object") ? l.data : {} });
      });
      return out;
    },
    // Worker から stop / level の両方を取得してキャッシュへ。Promise を返す。
    hydrateWordLists: function () {
      if (!this.getWorkerUrl() || typeof Api === "undefined") return Promise.resolve();
      return Promise.all([
        Api.getWordLists("stop").catch(function () { return { lists: [] }; }),
        Api.getWordLists("level").catch(function () { return { lists: [] }; })
      ]).then(function (res) {
        Store.setWLCache("stop", (res[0] && res[0].lists) || []);
        Store.setWLCache("level", (res[1] && res[1].lists) || []);
      });
    },

    /* 問題登録のセクション種別プルダウン候補（ローカルキャッシュ） */
    getSectionTypes: function () {
      var t = read(KEYS.sectionTypes, null);
      if (!Array.isArray(t) || !t.length) { t = DEFAULT_SECTION_TYPES.slice(); }
      return t;
    },
    setSectionTypes: function (t) { write(KEYS.sectionTypes, t); },

    /* 登録データ一括置換のルール（この端末に保持） */
    getReplaceRules: function () { var r = read(KEYS.replaceRules, null); return Array.isArray(r) ? r : []; },
    setReplaceRules: function (r) { write(KEYS.replaceRules, r); },

    /* 長文難易度の語彙:文長の重み（0〜1。この端末に保持。既定 0.5） */
    getDifficultyVocabWeight: function () {
      var v = Number(read(KEYS.difficultyVocabWeight, 0.5));
      if (isNaN(v)) v = 0.5;
      return Math.max(0, Math.min(1, v));
    },
    setDifficultyVocabWeight: function (w) {
      var v = Number(w); if (isNaN(v)) v = 0.5;
      write(KEYS.difficultyVocabWeight, Math.max(0, Math.min(1, v)));
    },

    /* 問題閲覧モーダルの文字サイズ */
    getFontSize: function () {
      var v = readRaw(KEYS.fontSize, "md");
      return ["xs", "sm", "md", "lg", "xl"].indexOf(v) >= 0 ? v : "md";
    },
    setFontSize: function (v) { localStorage.setItem(KEYS.fontSize, v); },

    /* 問題印刷の文字サイズ（表紙以外。問題閲覧とは独立して保存） */
    getPrintFontSize: function () {
      var v = readRaw(KEYS.printFontSize, "md");
      return ["xs", "sm", "md", "lg", "xl"].indexOf(v) >= 0 ? v : "md";
    },
    setPrintFontSize: function (v) { localStorage.setItem(KEYS.printFontSize, v); },

    /* 問題印刷の行間（表紙以外。1〜5の5段階。3=標準） */
    getPrintLineHeight: function () {
      var v = readRaw(KEYS.printLineHeight, "3");
      return ["1", "2", "3", "4", "5"].indexOf(v) >= 0 ? v : "3";
    },
    setPrintLineHeight: function (v) { localStorage.setItem(KEYS.printLineHeight, v); },

    /* 問題登録フォームの下書き（リロード後も同じ編集画面を復元） */
    getRegDraft: function () { return read(KEYS.regDraft, null); },
    setRegDraft: function (d) { write(KEYS.regDraft, d); },
    clearRegDraft: function () { try { localStorage.removeItem(KEYS.regDraft); } catch (e) {} },

    /* 印刷対象セクション（種別ごと。未設定はチェックあり = 印刷する） */
    isPrintSection: function (type) {
      var m = read(KEYS.printSections, {}) || {};
      return m[type] !== false;
    },
    setPrintSection: function (type, on) {
      var m = read(KEYS.printSections, {}) || {};
      m[type] = !!on;
      write(KEYS.printSections, m);
    }
  };

  global.Store = Store;
})(window);
