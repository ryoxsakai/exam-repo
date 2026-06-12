/* =====================================================================
   store.js — localStorage 設定の集中管理
   ===================================================================== */
(function (global) {
  "use strict";

  var KEYS = {
    workerUrl:     "cf_worker_url",          // Worker API のベースURL
    siteTitle:     "exam_site_title",        // サイトタイトル
    tabOrderMain:  "exam_taborder_main",     // 閲覧ページのタブ順
    tabOrderSet:   "exam_taborder_setting",  // 設定ページのタブ順
    lastTabSet:    "exam_lasttab_setting",   // 設定ページで最後に開いたタブ
    lastTabMain:   "exam_lasttab_main",      // 閲覧ページで最後に開いたタブ
    stopwords:     "exam_stopword_lists",    // ストップワードリスト [{name,words[]}]
    vocab:         "exam_vocab_lists",       // 語彙リスト [{name,words[]}]
    sectionTypes:  "exam_section_types"      // 問題登録のプルダウン候補（問題/解答/解説…）
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
  var DEFAULT_SECTION_TYPES = ["問題", "解答", "解説"];

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
      if (u && !/^https?:\/\//.test(u)) u = "https://" + u;
      return u;
    },
    setWorkerUrl: function (url) { localStorage.setItem(KEYS.workerUrl, (url || "").trim()); },

    /* サイトタイトル */
    getSiteTitle: function (fallback) { return readRaw(KEYS.siteTitle, fallback || "入試問題データベース"); },
    setSiteTitle: function (t) { localStorage.setItem(KEYS.siteTitle, t || ""); },

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

    /* 語彙リスト */
    getVocabLists: function () {
      var lists = read(KEYS.vocab, null);
      if (!Array.isArray(lists)) { lists = []; write(KEYS.vocab, lists); }
      return lists;
    },
    setVocabLists: function (lists) { write(KEYS.vocab, lists); },

    /* 問題登録のセクション種別プルダウン候補 */
    getSectionTypes: function () {
      var t = read(KEYS.sectionTypes, null);
      if (!Array.isArray(t) || !t.length) { t = DEFAULT_SECTION_TYPES.slice(); write(KEYS.sectionTypes, t); }
      return t;
    },
    setSectionTypes: function (t) { write(KEYS.sectionTypes, t); }
  };

  global.Store = Store;
})(window);
