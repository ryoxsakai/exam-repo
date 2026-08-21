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
    printHideLabels: "exam_print_hide_labels", // 印刷時に「問題」「本文」「設問」のセクション名を出さない
    printQPageBreak: "exam_print_qbreak",    // （旧）印刷時に大問ごとに改ページする。下の面別キーへ移行済み
    printQBreakQ:  "exam_print_qbreak_q",    // 問題面で大問ごとに改ページする
    printQBreakA:  "exam_print_qbreak_a",    // 解答・解説面で大問ごとに改ページする
    printHideHeadQ: "exam_print_hide_head_q", // 「問題」パート見出しを出さない
    printHideHeadA: "exam_print_hide_head_a", // 「解答・解説」パート見出しを出さない
    printSBreakQ:  "exam_print_sbreak_q",    // 問題面でセクションごとに改ページする
    printSBreakA:  "exam_print_sbreak_a",    // 解答・解説面でセクションごとに改ページする
    printQSubtitle: "exam_print_qsubtitle",  // 大問見出しを「1. 2018 ○○ 前期 大問3」形式にする
    printLineNumbers: "exam_print_linenum",  // 印刷時、本文セクションに5行ごとの行番号を付ける
    printGrayscale: "exam_print_grayscale",  // 印刷時、バッジ・ハイライト・画像などをグレースケールにする
    printFolderTitles: "exam_print_folder_titles", // お気に入りフォルダ印刷の表紙タイトル {folderId: title}
    replaceRules:  "exam_replace_rules",     // 登録データ一括置換のルール [{from,to,regex}]
    difficultyVocabWeight: "exam_difficulty_vocab_weight", // 長文難易度の語彙:文長の重み(0〜1、この端末のみ)
    examFavCache:  "exam_fav_cache",         // お気に入り大問を含む試験のキャッシュ {examId: Api.getExamの結果}
    favCollapsed:  "exam_fav_collapsed"      // お気に入りフォルダの折りたたみ状態 {folderId: true}（この端末のみ）
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

    /* ユーザー設定のアカウント同期（Googleログイン時のみ。Worker の user_settings に uid 単位で保存）。
       対象はタブ順とお気に入りフォルダ印刷の表紙タイトル。localStorage は常にこの端末の最新状態
       として即座に反映し、ログイン中はさらに Worker とも同期することで他端末にも反映されるように
       する。未ログイン・Worker未接続・通信エラー時は何もせず、常にlocalStorageのみへ
       フォールバックする（今までの挙動のまま）。 */
    pullUserSettingsFromAccount: function () {
      if (typeof Auth === "undefined" || !Auth.getCurrentUser() || typeof Api === "undefined") {
        return Promise.resolve(null);
      }
      return Api.getUserSettings().then(function (data) {
        if (!data) return null;
        if (Array.isArray(data.tab_order_main)) Store.setTabOrder("main", data.tab_order_main);
        if (Array.isArray(data.tab_order_setting)) Store.setTabOrder("setting", data.tab_order_setting);
        if (data.print_titles && typeof data.print_titles === "object" && !Array.isArray(data.print_titles)) {
          Store.setPrintFolderTitles(data.print_titles);
        }
        return data;
      }).catch(function () { return null; });
    },
    pushTabOrderToAccount: function (page, order) {
      if (typeof Auth === "undefined" || !Auth.getCurrentUser() || typeof Api === "undefined") return;
      var body = {};
      body[page === "setting" ? "tab_order_setting" : "tab_order_main"] = order;
      Api.updateUserSettings(body).catch(function () {});
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
    },

    /* 問題印刷タブ: 「問題」「本文」「設問」のセクション名ラベルを出さない（既定は出す） */
    getPrintHideLabels: function () { return read(KEYS.printHideLabels, false) === true; },
    setPrintHideLabels: function (on) { write(KEYS.printHideLabels, !!on); },

    /* 問題印刷タブ: 大問ごとに改ページする（既定は改ページしない＝続けて印刷）。
       問題面（side="q"）と解答・解説面（side="a"）で別々に設定できる。
       面別に分ける前の設定（exam_print_qbreak）が残っている場合はその値を引き継ぐ。 */
    getPrintQPageBreak: function (side) {
      var key = side === "a" ? KEYS.printQBreakA : KEYS.printQBreakQ;
      var v = read(key, null);
      if (v === null) return read(KEYS.printQPageBreak, false) === true;  // 旧設定から引き継ぎ
      return v === true;
    },
    setPrintQPageBreak: function (side, on) {
      write(side === "a" ? KEYS.printQBreakA : KEYS.printQBreakQ, !!on);
    },

    /* 問題印刷タブ: お気に入りフォルダに挿入したセクション見出しごとに改ページする
       （既定は改ページしない）。問題面（side="q"）と解答・解説面（side="a"）で別々に設定できる。 */
    getPrintSectionPageBreak: function (side) {
      return read(side === "a" ? KEYS.printSBreakA : KEYS.printSBreakQ, false) === true;
    },
    setPrintSectionPageBreak: function (side, on) {
      write(side === "a" ? KEYS.printSBreakA : KEYS.printSBreakQ, !!on);
    },

    /* 問題印刷タブ: パート見出し（「問題」「解答・解説」）を出さない（既定は出す） */
    getPrintHidePartHead: function (side) {
      return read(side === "a" ? KEYS.printHideHeadA : KEYS.printHideHeadQ, false) === true;
    },
    setPrintHidePartHead: function (side, on) {
      write(side === "a" ? KEYS.printHideHeadA : KEYS.printHideHeadQ, !!on);
    },

    /* 問題印刷タブ: 大問見出しを「1. 2018 ○○ 前期 大問3」形式にする（既定は「大問3」だけ）。
       お気に入りフォルダの印刷では大問が複数の試験にまたがるため、この形式が既定で有効になる
       （viewer.js 側で判断。ここはユーザーが明示的に選んだ値の保存のみ）。 */
    getPrintQSubtitle: function () { return read(KEYS.printQSubtitle, false) === true; },
    setPrintQSubtitle: function (on) { write(KEYS.printQSubtitle, !!on); },

    /* 問題印刷タブ: 本文セクションに5行ごとの行番号を付ける（既定はオフ） */
    getPrintLineNumbers: function () { return read(KEYS.printLineNumbers, false) === true; },
    setPrintLineNumbers: function (on) { write(KEYS.printLineNumbers, !!on); },

    /* 問題印刷タブ: 色付きのバッジ・ハイライト・画像などをグレースケールで印刷する */
    getPrintGrayscale: function () { return read(KEYS.printGrayscale, false) === true; },
    setPrintGrayscale: function (on) { write(KEYS.printGrayscale, !!on); },

    /* お気に入りフォルダ印刷の表紙タイトル（フォルダid → { lines: [...] }）。
       localStorage をこの端末のキャッシュ／未ログイン時のフォールバックとして常に保持し、
       ログイン中は Worker(user_settings.print_titles) にも保存してアカウントに紐づける。
       値が文字列・{top,mid,bottom} の場合も従来データとして読める（後方互換）。 */
    getPrintFolderTitles: function () {
      var m = read(KEYS.printFolderTitles, {});
      return (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
    },
    setPrintFolderTitles: function (map) { write(KEYS.printFolderTitles, map || {}); },
    // 保存済みの3行を返す（未設定の行は空文字）。旧形式の文字列は中央行として扱う。
    getPrintFolderTitleParts: function (folderId) {
      var v = this.getPrintFolderTitles()[String(folderId)];
      if (typeof v === "string") return { top: "", mid: v, bottom: "" };
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (Array.isArray(v.lines)) {
          return {
            top: typeof v.lines[0] === "string" ? v.lines[0] : "",
            mid: typeof v.lines[1] === "string" ? v.lines[1] : "",
            bottom: typeof v.lines[2] === "string" ? v.lines[2] : ""
          };
        }
        return {
          top: typeof v.top === "string" ? v.top : "",
          mid: typeof v.mid === "string" ? v.mid : "",
          bottom: typeof v.bottom === "string" ? v.bottom : ""
        };
      }
      return { top: "", mid: "", bottom: "" };
    },
    // 保存済みの表紙行を返す。旧3行形式も新しい可変行形式へ読み替える。
    getPrintFolderTitleLines: function (folderId) {
      var v = this.getPrintFolderTitles()[String(folderId)];
      if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.lines)) {
        return v.lines.map(function (line) { return typeof line === "string" ? line : ""; });
      }
      var p = this.getPrintFolderTitleParts(folderId);
      return [p.top, p.mid, p.bottom];
    },
    getPrintFolderTitleSizes: function (folderId) {
      var v = this.getPrintFolderTitles()[String(folderId)];
      var raw = v && typeof v === "object" && Array.isArray(v.sizes) ? v.sizes : [];
      var count = this.getPrintFolderTitleLines(folderId).length;
      var out = [];
      for (var i = 0; i < count; i++) {
        var n = Number(raw[i]);
        out.push(n >= 1 && n <= 5 ? n : null);
      }
      return out;
    },
    getPrintFolderTitleColors: function (folderId) {
      var v = this.getPrintFolderTitles()[String(folderId)];
      var raw = v && typeof v === "object" && Array.isArray(v.colors) ? v.colors : [];
      var count = this.getPrintFolderTitleLines(folderId).length;
      var out = [];
      for (var i = 0; i < count; i++) {
        var n = Number(raw[i]);
        out.push(n >= 1 && n <= 5 ? n : null);
      }
      return out;
    },
    // 表紙の全行をまとめて保存する。空行も位置を保つため削除せず保存する。
    setPrintFolderTitleLines: function (folderId, lines, sizes, colors) {
      var m = this.getPrintFolderTitles();
      var out = (Array.isArray(lines) ? lines : []).map(function (line) {
        return String(line || "").trim();
      });
      while (out.length < 3) out.push("");
      var outSizes = [];
      var hasSizes = false;
      for (var i = 0; i < out.length; i++) {
        var n = Number(Array.isArray(sizes) ? sizes[i] : null);
        outSizes.push(n >= 1 && n <= 5 ? n : null);
        if (n >= 1 && n <= 5) hasSizes = true;
      }
      var outColors = [];
      var hasColors = false;
      for (var j = 0; j < out.length; j++) {
        var c = Number(Array.isArray(colors) ? colors[j] : null);
        outColors.push(c >= 1 && c <= 5 ? c : null);
        if (c >= 1 && c <= 5) hasColors = true;
      }
      var value = { lines: out };
      if (hasSizes) value.sizes = outSizes;
      if (hasColors) value.colors = outColors;
      m[String(folderId)] = value;
      this.setPrintFolderTitles(m);
      this.pushPrintTitlesToAccount(m);
    },
    // 1行だけ保存する（part は "top"|"mid"|"bottom"）。空文字にするとその行を未設定に戻し、
    // 3行すべて未設定になればフォルダのキー自体を削除する。ログイン中はアカウントにも保存。
    setPrintFolderTitlePart: function (folderId, part, value) {
      var m = this.getPrintFolderTitles();
      var parts = this.getPrintFolderTitleParts(folderId);
      parts[part] = (value || "").trim();
      var key = String(folderId);
      if (parts.top || parts.mid || parts.bottom) {
        var out = {};
        if (parts.top) out.top = parts.top;
        if (parts.mid) out.mid = parts.mid;
        if (parts.bottom) out.bottom = parts.bottom;
        m[key] = out;
      } else {
        delete m[key];
      }
      this.setPrintFolderTitles(m);
      this.pushPrintTitlesToAccount(m);
    },
    pushPrintTitlesToAccount: function (map) {
      if (typeof Auth === "undefined" || !Auth.getCurrentUser() || typeof Api === "undefined") return;
      Api.updateUserSettings({ print_titles: map || this.getPrintFolderTitles() }).catch(function () {});
    },

    /* お気に入り大問を含む試験のキャッシュ（この端末のみ）。
       Api.getExam の結果を examId 単位で保持し、次回以降その場で即座に表示できるようにする
       （体感速度向上。裏で最新データを取得し直して差し替える stale-while-revalidate 方式）。
       お気に入りから外れた試験は pruneCachedExams で削除し、際限なく増えないようにする。 */
    getCachedExam: function (examId) {
      var all = read(KEYS.examFavCache, {}) || {};
      return all[examId] || null;
    },
    setCachedExam: function (examId, examData) {
      var all = read(KEYS.examFavCache, {}) || {};
      all[examId] = examData;
      write(KEYS.examFavCache, all);
    },
    pruneCachedExams: function (keepExamIds) {
      var all = read(KEYS.examFavCache, {}) || {};
      var keep = {};
      (keepExamIds || []).forEach(function (id) { keep[id] = true; });
      var changed = false;
      Object.keys(all).forEach(function (id) {
        if (!keep[id]) { delete all[id]; changed = true; }
      });
      if (changed) write(KEYS.examFavCache, all);
    },

    /* お気に入りフォルダの折りたたみ状態（この端末のみ。デフォルトは展開表示）。
       フォルダ削除時は pruneFavCollapsed で参照切れのキーを削除し、際限なく増えないようにする。 */
    getFavCollapsed: function () {
      var m = read(KEYS.favCollapsed, {});
      return (m && typeof m === "object") ? m : {};
    },
    setFavCollapsed: function (map) { write(KEYS.favCollapsed, map || {}); },
    pruneFavCollapsed: function (keepFolderIds) {
      var m = this.getFavCollapsed();
      var keep = {};
      (keepFolderIds || []).forEach(function (id) { keep[id] = true; });
      var changed = false;
      Object.keys(m).forEach(function (id) {
        if (!keep[id]) { delete m[id]; changed = true; }
      });
      if (changed) write(KEYS.favCollapsed, m);
    }
  };

  global.Store = Store;
})(window);
