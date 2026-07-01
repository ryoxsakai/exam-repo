/* =====================================================================
   viewer.js — 閲覧ページ (index.html) のロジック
   ===================================================================== */
(function () {
  "use strict";
  var el = UI.el, $ = UI.$, $all = UI.$all, create = UI.create, esc = UI.escapeHtml;

  var SECTION_ICONS = { "問題": "fa-circle-question", "解答": "fa-circle-check", "解説": "fa-comment-dots" };

  // 大問の表示用文字列。label があればそれを、無ければ question_number を返す（「大問」+これ）
  function qLabel(q) {
    return (q && q.label != null && String(q.label).trim()) ? String(q.label) : String(q && q.question_number);
  }

  function saveOpenExam(examId, qnum) { try { sessionStorage.setItem("exam_open_id", examId + ":" + qnum); } catch (e) {} }
  function clearOpenExam() { try { sessionStorage.removeItem("exam_open_id"); } catch (e) {} }
  function getOpenExam() {
    try {
      var v = sessionStorage.getItem("exam_open_id");
      if (!v) return null;
      var parts = v.split(":");
      return { examId: Number(parts[0]), qnum: parts[1] ? Number(parts[1]) : null };
    } catch (e) { return null; }
  }

  var TAB_DEFS = {
    search: { id: "search", label: "通常検索", icon: "fa-table-list" },
    tree:   { id: "tree",   label: "ツリー検索", icon: "fa-sitemap" },
    corpus: { id: "corpus", label: "コーパス検索", icon: "fa-language" },
    print:  { id: "print",  label: "問題印刷",   icon: "fa-print" }
  };
  var DEFAULT_ORDER = ["tree", "search", "corpus", "print"];

  // 状態
  var state = {
    filter: { word: "", universityName: "", year: "", schedule: "", qnum: "", category: "", wordsMin: "", wordsMax: "", level: "" },
    rows: [],
    sortedRows: [],
    sort: { key: "year", dir: "desc" },
    nav: { examId: null, qnum: null },
    config: null,
    corpus: null,
    // null = 制限なし。配列なら該当値のみ対象（値は文字列で保持）
    // null = 制限なし。配列なら該当値のみ対象（値は文字列で保持）。sections は対象セクション種別。
    corpusFilter: { universities: null, years: null, schedules: null, categories: null, sections: ["問題", "本文", "設問"] },
    levelStats: null,
    levelListName: "",
    covOffList: null,
    covListName: "",
    printExam: null,     // 印刷タブで構築した {year,university_name,schedule,questions[]}
    printSel: { uni: "", year: "", sched: "" },  // 印刷タブで選んだ大学/年度/方式
    printQSel: {},       // 印刷タブで選んだ大問（key=question_number文字列, value=真偽。未設定は印刷対象）
    longLevel: null,     // 長文レベルのキャッシュ {src, byKey, cutoffs}（四分位の相対難易度帯用）
    printTreeLoaded: false,
    treeLoaded: false,   // ツリー検索を読み込み済みか
    uniReading: {},      // 大学名 → よみがな（五十音ソート用）
    uniAbbr: {},         // 大学名 → 略称（表示用。無ければ正式名）
    charts: {}
  };

  // 大学名の並び替え比較（よみがな優先 → 名前。ともに ja ロケール）
  function uniCmp(a, b) {
    var ra = state.uniReading[a] || a, rb = state.uniReading[b] || b;
    return ra.localeCompare(rb, "ja") || a.localeCompare(b, "ja");
  }

  /* ---------------- 初期化 ---------------- */
  function init() {
    // サイトタイトル
    var title = Store.getSiteTitle();
    el("site-title").textContent = title;
    el("site-subtitle").textContent = Store.getSiteSubtitle();
    document.title = title;

    // ナビリンクを独自ドメイン基準に（リンク切れ防止）
    UI.applyDomainLinks();
    // 画像記法 ![](/api/image/..) の解決基準を Worker URL に
    if (Markup.setImageBase) Markup.setImageBase(Store.getWorkerUrl() || "");

    // タブ構築
    var order = Store.getTabOrder("main", DEFAULT_ORDER);
    var active = Store.getLastTab("main");
    if (DEFAULT_ORDER.indexOf(active) < 0) active = order[0];
    UI.buildTabs({
      tabsEl: el("main-tabs"), order: order, defs: TAB_DEFS, active: active, page: "main", iconOnly: true,
      onChange: function (id) { Store.setLastTab("main", id); if (id === "corpus") refreshCorpusLists(); if (id === "print") openPrintTab(); if (id === "tree") loadTree(); }
    });
    UI.setActiveTab(el("main-tabs"), active);
    if (active === "corpus") refreshCorpusLists(); else ensureCorpusControls();
    if (active === "print") openPrintTab();
    if (active === "tree") loadTree();

    // モーダル配線
    UI.wireModal(el("search-modal"));
    UI.wireModal(el("exam-modal"));
    UI.wireModal(el("level-detail-modal"));
    // 試験モーダルを閉じたとき、保存済み exam ID をクリア
    var _examModal = el("exam-modal");
    _examModal.addEventListener("mousedown", function (e) { if (e.target === _examModal) clearOpenExam(); });
    $all("[data-close]", _examModal).forEach(function (b) { b.addEventListener("click", clearOpenExam); });
    el("btn-open-search").addEventListener("click", openSearch);
    el("btn-open-search-2").addEventListener("click", openSearch);
    el("sm-run").addEventListener("click", runSearch);
    if (el("sm-category")) el("sm-category").addEventListener("change", toggleWordsRow);
    el("btn-clear-filter").addEventListener("click", clearFilter);
    // 難易度の重み設定モーダル
    if (el("level-weight-modal")) {
      UI.wireModal(el("level-weight-modal"));
      if (el("sm-level-weight")) el("sm-level-weight").addEventListener("click", openLevelWeight);
      if (el("lw-range")) el("lw-range").addEventListener("input", updateLevelWeightLabels);
      if (el("lw-save")) el("lw-save").addEventListener("click", saveLevelWeight);
    }
    el("btn-run-corpus").addEventListener("click", runCorpus);
    UI.wireModal(el("corpus-filter-modal"));
    el("btn-corpus-filter").addEventListener("click", openCorpusFilter);
    el("cf-apply").addEventListener("click", applyCorpusFilterModal);
    el("cf-reset").addEventListener("click", function () {
      $all('#corpus-filter-body input[type="checkbox"]').forEach(function (b) { b.checked = true; });
    });
    el("exam-print").addEventListener("click", printExam);
    el("exam-copy").addEventListener("click", copyExam);
    el("exam-fontsize").addEventListener("click", cycleFontSize);
    applyFontSize(Store.getFontSize());
    el("exam-prev").addEventListener("click", function () {
      var idx = findNavIndex();
      if (idx > 0) { var r = state.sortedRows[idx - 1]; openExam(r.exam_id, r.question_number); }
    });
    el("exam-next").addEventListener("click", function () {
      var idx = findNavIndex();
      if (idx >= 0 && idx < state.sortedRows.length - 1) { var r = state.sortedRows[idx + 1]; openExam(r.exam_id, r.question_number); }
    });
    el("exam-show-all").addEventListener("click", function () {
      if (state.nav.examId != null) openExam(state.nav.examId, null);
    });

    // ツリー検索 再読み込み
    var treeRefresh = el("btn-tree-refresh");
    if (treeRefresh) treeRefresh.addEventListener("click", function () { loadTree(true); });

    // 問題印刷タブ
    el("pr-cover").addEventListener("change", renderPrintPreview);
    el("pr-fontsize").value = Store.getPrintFontSize();
    el("pr-fontsize").addEventListener("change", function () {
      Store.setPrintFontSize(el("pr-fontsize").value);
      renderPrintPreview();
    });
    el("pr-lineheight").value = Store.getPrintLineHeight();
    el("pr-lineheight").addEventListener("change", function () {
      Store.setPrintLineHeight(el("pr-lineheight").value);
      renderPrintPreview();
    });
    el("btn-print-run").addEventListener("click", runPrint);
    el("btn-print-run-2").addEventListener("click", runPrint);

    // 検索モーダル内タブ
    $all("#search-modal-tabs .tab").forEach(function (t) {
      t.addEventListener("click", function () {
        var id = t.getAttribute("data-mtab");
        $all("#search-modal-tabs .tab").forEach(function (x) { x.classList.toggle("active", x === t); });
        $all("[data-mpanel]", el("search-modal")).forEach(function (p) {
          p.style.display = p.getAttribute("data-mpanel") === id ? "" : "none";
        });
      });
    });

    if (!Store.getWorkerUrl()) {
      el("results-area").innerHTML = noWorkerHtml();
      return;
    }
    var _saved = getOpenExam();
    loadConfig().then(loadResults);
    if (_saved) openExam(_saved.examId, _saved.qnum);
  }

  function noWorkerHtml() {
    return '<div class="card"><div class="empty"><i class="fa-solid fa-plug-circle-xmark ic"></i>' +
      'Worker URL が未設定です。<br><a href="setting/">設定ページ →「接続設定」</a> で Worker URL を登録してください。</div></div>';
  }

  /* ---------------- 設定読み込み（年度/大学/方式の選択肢） ---------------- */
  function loadConfig() {
    return Promise.all([
      Api.getConfig().catch(function () { return {}; }),
      Api.getUniversities().catch(function () { return { universities: [] }; })
    ]).then(function (res) {
      var cfg = res[0] || {}, unis = (res[1] && res[1].universities) || [];
      state.config = cfg;
      // 大学名 → 略称のマップ（表示用）
      state.uniAbbr = {};
      unis.forEach(function (u) { if (u && u.name && u.abbreviation) state.uniAbbr[u.name] = u.abbreviation; });
      // タイトルは Worker 側設定があれば優先（未保存ならローカル）
      if (cfg.site_title) {
        el("site-title").textContent = cfg.site_title;
        document.title = cfg.site_title;
      }
      if (cfg.site_subtitle) {
        Store.setSiteSubtitle(cfg.site_subtitle);
        el("site-subtitle").textContent = cfg.site_subtitle;
      }
      // 独自ドメインが Worker 側にあり、ローカル未設定なら取り込んでリンク再適用
      if (cfg.custom_domain && !Store.getCustomDomain()) {
        Store.setCustomDomain(cfg.custom_domain);
        UI.applyDomainLinks();
      }
      fillSelect(el("sm-year"), cfg.year_presets || [], "指定なし");
      fillSelect(el("sm-schedule"), cfg.schedules || [], "指定なし");
      fillSelect(el("sm-university"), unis.map(function (u) { return u.name; }), "指定なし");
      fillSelect(el("sm-category"), cfg.question_categories || [], "指定なし");
    });
  }

  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = '<option value="">' + esc(placeholder) + "</option>";
    items.forEach(function (it) {
      var o = create("option"); o.value = it; o.textContent = it; sel.appendChild(o);
    });
  }

  /* ---------------- 検索モーダル ---------------- */
  // 種別=長文 のときだけ語数・難易度の絞り込み欄を表示
  function toggleWordsRow() {
    var on = el("sm-category") && el("sm-category").value === "長文";
    if (el("sm-words-row")) el("sm-words-row").style.display = on ? "" : "none";
    if (el("sm-level-row")) el("sm-level-row").style.display = on ? "" : "none";
  }

  /* ---- 難易度の重み設定（語彙 : 文長。Worker config で全端末共有） ---- */
  function updateLevelWeightLabels() {
    var v = Number(el("lw-range").value);
    el("lw-vocab-val").textContent = v;
    el("lw-sent-val").textContent = 100 - v;
  }
  function openLevelWeight() {
    el("lw-range").value = String(Math.round(difficultyWeights().vocab * 100));
    el("lw-status").textContent = "";
    updateLevelWeightLabels();
    UI.openModal(el("level-weight-modal"));
  }
  function saveLevelWeight() {
    var v = Math.max(0, Math.min(1, Number(el("lw-range").value) / 100));
    Store.setDifficultyVocabWeight(v);
    state.longLevel = null;  // 重み変更で相対帯を再計算
    UI.toast("重みを保存しました（この端末）", "ok");
    UI.closeModal(el("level-weight-modal"));
    if (state.filter.category === "長文") loadResults();  // 表示中なら反映
  }
  function openSearch() {
    el("sm-word").value = state.filter.word;
    el("sm-university").value = state.filter.universityName;
    el("sm-year").value = state.filter.year;
    el("sm-schedule").value = state.filter.schedule;
    el("sm-qnum").value = state.filter.qnum;
    el("sm-category").value = state.filter.category;
    if (el("sm-words-min")) el("sm-words-min").value = state.filter.wordsMin;
    if (el("sm-words-max")) el("sm-words-max").value = state.filter.wordsMax;
    if (el("sm-level")) el("sm-level").value = state.filter.level;
    toggleWordsRow();
    UI.openModal(el("search-modal"));
  }
  function runSearch() {
    state.filter = {
      word: el("sm-word").value.trim(),
      universityName: el("sm-university").value,
      year: el("sm-year").value,
      schedule: el("sm-schedule").value,
      qnum: el("sm-qnum").value.trim(),
      category: el("sm-category").value,
      wordsMin: el("sm-words-min") ? el("sm-words-min").value.trim() : "",
      wordsMax: el("sm-words-max") ? el("sm-words-max").value.trim() : "",
      level: el("sm-level") ? el("sm-level").value : ""
    };
    UI.closeModal(el("search-modal"));
    UI.setActiveTab(el("main-tabs"), "search");
    Store.setLastTab("main", "search");
    loadResults();
  }
  function clearFilter() {
    state.filter = { word: "", universityName: "", year: "", schedule: "", qnum: "", category: "", wordsMin: "", wordsMax: "", level: "" };
    loadResults();
  }

  // 難易度ロジックは共有モジュール Difficulty(difficulty.js) に集約。以下は薄いラッパ。
  var LEVEL_BAND_LABEL = Difficulty.BAND_LABEL;
  function bodyWordCount(q) { return Difficulty.wordCount(Difficulty.bodyText(q)); }
  function difficultyWeights() { return Difficulty.weights(); }
  // 本文セクションの生テキスト → { score, band }（帯は取得済み四分位、無ければ絶対フォールバック）
  function sectionDifficulty(rawText) {
    var score = Difficulty.scoreForText(rawText);
    return { score: score, band: Difficulty.band(score, state.longLevel ? state.longLevel.cutoffs : null) };
  }
  // 登録済み「長文」大問のレベル分布（四分位境界つき）を state.corpus 単位でキャッシュ。
  function ensureLongLevels() {
    var w = Difficulty.weights();
    if (state.longLevel && state.longLevel.src === state.corpus && state.longLevel.wv === w.vocab) return state.longLevel;
    var r = Difficulty.corpusLevels(state.corpus || [], w);
    state.longLevel = { src: state.corpus, wv: w.vocab, byKey: r.byKey, cutoffs: r.cutoffs };
    return state.longLevel;
  }

  /* ---------------- 結果テーブル ---------------- */
  function loadResults() {
    if (!Store.getWorkerUrl()) { el("results-area").innerHTML = noWorkerHtml(); return; }
    updateFilterSummary();
    el("results-area").innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> 読み込み中…</div></div>';
    // 種別=長文 のときは本文語数を表示・絞り込みするためコーパス全文を併用（キャッシュ）
    var needWords = state.filter.category === "長文";
    var searchP = Api.search({
      word: state.filter.word, universityName: state.filter.universityName,
      year: state.filter.year, schedule: state.filter.schedule,
      category: state.filter.category
    });
    var corpusP = !needWords ? Promise.resolve(null)
      : (state.corpus ? Promise.resolve({ questions: state.corpus }) : Api.getCorpus());
    Promise.all([searchP, corpusP]).then(function (res) {
      var data = res[0];
      if (res[1]) state.corpus = res[1].questions || state.corpus;
      var rows = (data.results || []).map(function (r) {
        return {
          exam_id: r.exam_id, question_id: r.question_id,
          question_number: r.question_number, category: r.category || "",
          university_name: r.university_name, year: r.year,
          schedule: r.schedule, occurrences: r.total_occurrences || 0
        };
      });
      // 大問番号フィルタ（クライアント側）
      if (state.filter.qnum) {
        var qn = Number(state.filter.qnum);
        rows = rows.filter(function (r) { return r.question_number === qn; });
      }
      // 語数・語彙レベルの付与・絞り込み（種別=長文 のとき）
      if (needWords) {
        var corpusByKey = {};
        (state.corpus || []).forEach(function (q) { corpusByKey[q.exam_id + ":" + q.question_number] = q; });
        var ll = ensureLongLevels();
        rows.forEach(function (r) {
          var key = r.exam_id + ":" + r.question_number;
          var q = corpusByKey[key];
          r.words = q ? bodyWordCount(q) : 0;
          var e = ll.byKey[key];
          r.level = e ? e.score : 0;
          r.levelVocab = e ? e.vocab : 0;
          r.levelAsl = e ? e.asl : 0;
          r.levelBand = Difficulty.band(r.level, ll.cutoffs);
        });
        var mn = state.filter.wordsMin !== "" ? Number(state.filter.wordsMin) : null;
        var mx = state.filter.wordsMax !== "" ? Number(state.filter.wordsMax) : null;
        if (mn != null && !isNaN(mn)) rows = rows.filter(function (r) { return r.words >= mn; });
        if (mx != null && !isNaN(mx)) rows = rows.filter(function (r) { return r.words <= mx; });
        if (state.filter.level) rows = rows.filter(function (r) { return r.levelBand === state.filter.level; });
      }
      state.rows = rows;
      renderTable();
    }).catch(function (e) {
      el("results-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div></div>";
    });
  }

  // 大問番号の表示（GROUP_CONCAT された番号を整列・重複除去して整形）
  function fmtQNums(matching, count) {
    var nums = String(matching || "").split(",").map(function (x) { return Number(x.trim()); })
      .filter(function (n) { return !isNaN(n); });
    var uniq = [];
    nums.sort(function (a, b) { return a - b; }).forEach(function (n) { if (uniq.indexOf(n) < 0) uniq.push(n); });
    return uniq.length ? uniq.join(", ") : String(count || 0);
  }

  function updateFilterSummary() {
    var f = state.filter, parts = [];
    if (f.word) parts.push('キーワード「' + f.word + '」');
    if (f.year) parts.push(f.year + "年");
    if (f.universityName) parts.push(f.universityName);
    if (f.schedule) parts.push(f.schedule);
    if (f.qnum) parts.push("大問" + f.qnum);
    if (f.category) parts.push(f.category);
    if (f.category === "長文" && (f.wordsMin !== "" || f.wordsMax !== "")) {
      parts.push("語数 " + (f.wordsMin !== "" ? f.wordsMin : "0") + "〜" + (f.wordsMax !== "" ? f.wordsMax : "∞"));
    }
    if (f.category === "長文" && f.level) parts.push("難易度 " + (LEVEL_BAND_LABEL[f.level] || f.level));
    el("filter-summary").textContent = parts.length ? parts.join(" / ") + " で絞り込み中" : "すべての入試問題を表示中";
  }

  function renderTable() {
    var rows = state.rows.slice();
    var key = state.sort.key, dir = state.sort.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === "year" || key === "question_number" || key === "occurrences" || key === "words" || key === "level") { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av || "").toLowerCase(); bv = String(bv || "").toLowerCase(); }
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });

    if (!rows.length) {
      el("results-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>該当する入試問題がありません。</div></div>';
      return;
    }

    var showOcc = !!state.filter.word;
    var showWords = state.filter.category === "長文";
    var sameCtx = rows.length > 0 && rows.every(function (r) {
      return r.year === rows[0].year && r.university_name === rows[0].university_name && r.schedule === rows[0].schedule;
    });
    var cols = [
      { key: "year", label: "年度" },
      { key: "university_name", label: "大学" },
      { key: "schedule", label: "方式" },
      { key: "question_number", label: "大問" },
      { key: "category", label: "種別" }
    ];
    if (showWords) cols.push({ key: "words", label: "語数" });
    if (showWords) cols.push({ key: "level", label: "レベル" });
    if (showOcc) cols.push({ key: "occurrences", label: "出現回数" });

    var tableCls = "data exam-list-table" + (showWords ? " has-words" : "") + (showOcc ? " has-occ" : "") + (sameCtx ? " same-exam-context" : "");
    var html = '<div class="table-wrap exam-list-wrap"><table class="' + tableCls + '"><colgroup>' +
      '<col class="col-year"><col class="col-uni"><col class="col-schedule"><col class="col-qnum"><col class="col-category">' +
      (showWords ? '<col class="col-words"><col class="col-level">' : "") +
      (showOcc ? '<col class="col-occ">' : "") + '<col class="col-actions"></colgroup><thead><tr>';
    cols.forEach(function (c) {
      var sorted = state.sort.key === c.key;
      var ic = sorted ? (state.sort.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort";
      html += '<th class="sortable' + (sorted ? " sorted" : "") + '" data-sort="' + c.key + '">' +
        esc(c.label) + '<i class="fa-solid ' + ic + ' sort-ic"></i></th>';
    });
    html += '<th class="col-actions" style="text-align:right">表示</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var uniFull = r.university_name || "";
      var uniAbbr = state.uniAbbr[uniFull];
      var uniCell = (uniAbbr && uniAbbr !== uniFull)
        ? '<strong class="uni-full">' + esc(uniFull) + '</strong><strong class="uni-abbr">' + esc(uniAbbr) + "</strong>"
        : "<strong>" + esc(uniFull) + "</strong>";
      html += "<tr>" +
        '<td data-label="年度"><span class="pill em">' + esc(r.year) + "</span></td>" +
        '<td data-label="大学">' + uniCell + "</td>" +
        '<td data-label="方式">' + esc(r.schedule) + "</td>" +
        '<td data-label="大問">' + esc(qLabel(r)) + "</td>" +
        '<td data-label="種別">' + (r.category ? esc(r.category) : '<span class="hint">—</span>') + "</td>" +
        (showWords ? '<td data-label="語数"><span class="pill">' + esc(r.words != null ? r.words : 0) + "</span></td>" : "") +
        (showWords ? '<td data-label="レベル">' + (r.level ? '<span class="pill" title="合成 ' + esc(r.level.toFixed(2)) + '（語彙 ' + esc((r.levelVocab || 0).toFixed(2)) + ' ・ 平均文長 ' + esc(Math.round(r.levelAsl || 0)) + '語）／' + esc(LEVEL_BAND_LABEL[r.levelBand] || "") + '">' + esc(r.level.toFixed(1)) + " " + esc(r.levelBand) + "</span>" : '<span class="hint">—</span>') + "</td>" : "") +
        (showOcc ? '<td data-label="出現回数"><span class="pill">' + esc(r.occurrences) + "</span></td>" : "") +
        '<td class="row-actions"><button class="icon-btn sm" data-view="' + r.exam_id + ":" + r.question_number + '" title="表示"><i class="fa-solid fa-file-lines"></i></button></td>' +
        "</tr>";
    });
    html += "</tbody></table></div>";
    state.sortedRows = rows;
    el("results-area").innerHTML = html;

    $all("th.sortable", el("results-area")).forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-sort");
        if (state.sort.key === k) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else { state.sort.key = k; state.sort.dir = (k === "year" || k === "question_number" || k === "occurrences" || k === "words" || k === "level") ? "desc" : "asc"; }
        renderTable();
      });
    });
    $all("[data-view]", el("results-area")).forEach(function (b) {
      b.addEventListener("click", function () {
        var val = b.getAttribute("data-view");
        var parts = val.split(":");
        openExam(Number(parts[0]), parts[1] ? Number(parts[1]) : null);
      });
    });
  }

  /* ---------------- 入試問題 ナビゲーション ---------------- */
  function findNavIndex() {
    var nav = state.nav, rows = state.sortedRows;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].exam_id === nav.examId && rows[i].question_number === nav.qnum) return i;
    }
    return -1;
  }
  function updateExamNav() {
    var idx = findNavIndex(), total = state.sortedRows.length;
    var prevBtn = el("exam-prev"), nextBtn = el("exam-next");
    prevBtn.disabled = (idx <= 0);
    nextBtn.disabled = (idx < 0 || idx >= total - 1);
    el("exam-nav-label").textContent = (idx >= 0 && total > 0) ? (idx + 1) + " / " + total : "";
    el("exam-show-all").style.display = (state.nav.qnum != null) ? "" : "none";
  }

  /* ---------------- ツリー検索（大学→年度→方式→大問） ---------------- */
  function loadTree(force) {
    var box = el("tree-area");
    if (!box) return;
    if (!Store.getWorkerUrl()) { box.innerHTML = noWorkerHtml(); return; }
    if (state.treeLoaded && !force) return;
    box.innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> 読み込み中…</div></div>';
    Api.getExams({}).then(function (data) {
      var exams = data.exams || [];
      if (!exams.length) {
        box.innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>登録された入試問題がありません。</div></div>';
        return;
      }
      box.innerHTML = renderTree(buildTreeData(exams));
      wireTree();
      state.treeLoaded = true;
    }).catch(function (e) {
      box.innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div></div>";
    });
  }

  // exams[] → { uniName: { year: { schedule: [examId,...] } } }
  function buildTreeData(exams) {
    var unis = {};
    exams.forEach(function (e) {
      var u = e.university_name || "（大学名なし）";
      var y = String(e.year);
      var s = e.schedule || "（方式なし）";
      if (e.university_reading) state.uniReading[u] = e.university_reading;
      if (!unis[u]) unis[u] = {};
      if (!unis[u][y]) unis[u][y] = {};
      if (!unis[u][y][s]) unis[u][y][s] = [];
      unis[u][y][s].push(e.id);
    });
    return unis;
  }

  function schedOrder(s) {
    var cfg = (state.config && state.config.schedules) || [];
    var i = cfg.indexOf(s);
    return i < 0 ? 999 : i;
  }

  function treeRow(lvl, icon, label, data) {
    var attrs = "";
    if (data) Object.keys(data).forEach(function (k) { attrs += " data-" + k + '="' + esc(String(data[k])) + '"'; });
    return '<button type="button" class="tree-row tree-row-' + lvl + '"' + attrs + '>' +
      '<i class="fa-solid fa-chevron-right tree-chev"></i>' +
      '<i class="fa-solid ' + icon + ' tree-ic"></i>' +
      '<span class="tree-label">' + label + "</span></button>";
  }

  function renderTree(unis) {
    var uniNames = Object.keys(unis).sort(uniCmp);
    var html = '<div class="tree card">';
    uniNames.forEach(function (u) {
      html += '<div class="tree-node">' + treeRow("uni", "fa-building-columns", esc(u)) + '<div class="tree-children" hidden>';
      Object.keys(unis[u]).sort(function (a, b) { return Number(b) - Number(a); }).forEach(function (y) {
        html += '<div class="tree-node">' + treeRow("year", "fa-calendar-days", esc(y) + "年度") + '<div class="tree-children" hidden>';
        Object.keys(unis[u][y]).sort(function (a, b) { return (schedOrder(a) - schedOrder(b)) || a.localeCompare(b, "ja"); }).forEach(function (s) {
          html += '<div class="tree-node">' +
            treeRow("sched", "fa-layer-group", esc(s), { exams: unis[u][y][s].join(","), uni: u, year: y, sched: s }) +
            '<div class="tree-children" hidden data-loaded="0"></div></div>';
        });
        html += "</div></div>";
      });
      html += "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function wireTree() {
    $all(".tree-row", el("tree-area")).forEach(function (row) {
      row.addEventListener("click", function () {
        var children = row.nextElementSibling;
        if (!children || !children.classList.contains("tree-children")) return;
        var willOpen = children.hidden;
        children.hidden = !willOpen;
        row.classList.toggle("open", willOpen);
        if (willOpen && row.classList.contains("tree-row-sched") && children.getAttribute("data-loaded") === "0") {
          loadTreeQuestions(row, children);
        }
      });
    });
  }

  // 方式ノードを開いたとき、その配下の大問を遅延読み込み
  function loadTreeQuestions(row, children) {
    children.setAttribute("data-loaded", "1");
    children.innerHTML = '<div class="tree-msg"><span class="spinner"></span> 読み込み中…</div>';
    var ids = (row.getAttribute("data-exams") || "").split(",").filter(Boolean).map(Number);
    Promise.all(ids.map(function (id) { return Api.getExam(id).catch(function () { return null; }); })).then(function (results) {
      var rows = [];
      results.forEach(function (r) {
        if (!r || !r.exam) return;
        var ex = r.exam;
        (ex.questions || []).slice().sort(function (a, b) {
          return (Number(a.question_number) || 0) - (Number(b.question_number) || 0);
        }).forEach(function (q) {
          rows.push({ exam_id: ex.id, question_number: q.question_number, label: q.label, university_name: ex.university_name, year: ex.year, schedule: ex.schedule, category: q.category });
        });
      });
      if (!rows.length) { children.innerHTML = '<div class="tree-msg">大問が登録されていません。</div>'; return; }
      var html = "";
      rows.forEach(function (r, i) {
        html += '<button type="button" class="tree-row tree-row-q" data-eid="' + r.exam_id + '" data-q="' + esc(String(r.question_number)) + '" data-i="' + i + '">' +
          '<i class="fa-solid fa-file-lines tree-ic"></i>' +
          '<span class="tree-label">大問' + esc(qLabel(r)) +
          (r.category ? ' <span class="tree-cat">' + esc(r.category) + "</span>" : "") +
          "</span></button>";
      });
      children.innerHTML = html;
      children._rows = rows;
      $all(".tree-row-q", children).forEach(function (b) {
        b.addEventListener("click", function () {
          state.sortedRows = children._rows;  // 前/次ナビをこの方式内に限定
          openExam(Number(b.getAttribute("data-eid")), Number(b.getAttribute("data-q")));
        });
      });
    }).catch(function (e) {
      children.innerHTML = '<div class="tree-msg">' + esc(e.message) + "</div>";
    });
  }

  /* ---------------- 入試問題 表示モーダル ---------------- */
  function openExam(examId, qnum) {
    state.nav = { examId: examId, qnum: qnum };
    updateExamNav();
    saveOpenExam(examId, qnum);
    UI.openModal(el("exam-modal"));
    if (el("exam-shortcuts")) { el("exam-shortcuts").hidden = true; el("exam-shortcuts").innerHTML = ""; }
    el("exam-modal-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      var title = ex.year + "年 " + ex.university_name + " " + ex.schedule;
      if (qnum != null) {
        var titleQ = (ex.questions || []).filter(function (q) { return q.question_number === qnum; })[0];
        title += " 大問" + qLabel(titleQ || { question_number: qnum });
      }
      el("exam-modal-title").textContent = title;

      // 指定された大問番号のみ表示（未指定の場合はすべて）
      var questions = ex.questions || [];
      if (qnum != null) {
        questions = questions.filter(function (q) { return q.question_number === qnum; });
      }

      // 本文があり難易度帯の基準（四分位）が未取得なら、コーパスを取り込んでから描画
      var hasBody = questions.some(function (q) {
        return Markup.parseSections(q.problem_text || "").some(function (s) { return s.type === "本文"; });
      });
      var finish = function () {
        if (hasBody) { ensureLongLevels(); }
        renderExamBody(questions, qnum == null && questions.length > 1);
      };
      if (hasBody && !state.longLevel) {
        (state.corpus ? Promise.resolve() : Api.getCorpus().then(function (d) { state.corpus = d.questions || []; }, function () {}))
          .then(finish, finish);
      } else {
        finish();
      }
    }).catch(function (e) {
      el("exam-modal-body").innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div>";
    });
  }

  // 表示モーダルの本文 HTML を組み立てて反映（＋下部ショートカット）
  function renderExamBody(questions, showQHead) {
    var body = "";
    questions.forEach(function (q) {
      var fields = [];
      var sections = Markup.parseSections(q.problem_text || "");
      var hasAnswerSection = sections.some(function (s) { return s.type === "解答"; });
      var hasCommentarySection = sections.some(function (s) { return s.type === "解説"; });
      if (q.answer_text && q.answer_text.trim() && !hasAnswerSection) sections.push({ type: "解答", text: q.answer_text });
      if (q.commentary_text && q.commentary_text.trim() && !hasCommentarySection) sections.push({ type: "解説", text: q.commentary_text });
      sections.forEach(function (sec) {
        if (sec.text.trim()) fields.push(renderField(sec.type, SECTION_ICONS[sec.type] || "fa-circle-question", sec.text));
      });
      var head = showQHead ? '<div class="modal-qhead">大問' + esc(qLabel(q)) + "</div>" : "";
      body += head + '<div class="exam-section">' + fields.join('<hr class="exam-hr exam-field-sep">') + "</div>";
    });
    el("exam-modal-body").innerHTML = body || '<div class="empty">大問が登録されていません。</div>';
    wirePrintChecks();
    buildExamShortcuts();
  }

  // モーダル下部に「大問N / セクション」への横スクロール式ショートカットを生成
  function buildExamShortcuts() {
    var bar = el("exam-shortcuts");
    if (!bar) return;
    var body = el("exam-modal-body");
    var items = $all(".modal-qhead, .exam-field", body);
    if (items.length < 2) { bar.hidden = true; bar.innerHTML = ""; return; }
    var html = "";
    items.forEach(function (node, i) {
      node.setAttribute("data-anchor", "a" + i);
      var isQ = node.classList.contains("modal-qhead");
      var label = isQ ? node.textContent.trim() : (node.getAttribute("data-sectype") || "");
      if (!label) return;
      html += '<button type="button" class="sc-btn' + (isQ ? " sc-q" : "") + '" data-scroll="a' + i + '">' + esc(label) + "</button>";
    });
    bar.innerHTML = html;
    bar.hidden = false;
    $all("[data-scroll]", bar).forEach(function (b) {
      b.addEventListener("click", function () {
        var t = body.querySelector('[data-anchor="' + b.getAttribute("data-scroll") + '"]');
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // 文字サイズ切替（小→中→大の循環。localStorage に保存し印刷にも反映）
  var FS_ORDER = ["xs", "sm", "md", "lg", "xl"];
  var FS_LABEL = { xs: "極小", sm: "小", md: "中", lg: "大", xl: "極大" };
  function applyFontSize(size) {
    var body = el("exam-modal-body");
    FS_ORDER.forEach(function (s) { body.classList.remove("fs-" + s); });
    body.classList.add("fs-" + size);
    el("exam-fontsize").title = "文字サイズ変更（現在: " + FS_LABEL[size] + "）";
  }
  function cycleFontSize() {
    var cur = Store.getFontSize();
    var next = FS_ORDER[(FS_ORDER.indexOf(cur) + 1) % FS_ORDER.length];
    Store.setFontSize(next);
    applyFontSize(next);
    UI.toast("文字サイズ: " + FS_LABEL[next], "ok");
  }

  // セクションタイトル横の「印刷」チェックを配線（種別ごとに localStorage 共有）
  function wirePrintChecks() {
    $all("[data-printsec]", el("exam-modal-body")).forEach(function (cb) {
      cb.addEventListener("change", function () {
        var type = cb.getAttribute("data-printsec");
        Store.setPrintSection(type, cb.checked);
        // 同じ種別のチェックを同期（複数大問で同種セクションがある場合）
        $all("[data-printsec]", el("exam-modal-body")).forEach(function (o) {
          if (o.getAttribute("data-printsec") === type) o.checked = cb.checked;
        });
      });
    });
  }

  // 印刷: モーダルUIは出さず、本文のみを #print-area 経由で印刷
  // チェックを外したセクションは印刷から除外する
  function printExam() {
    var area = el("print-area");
    if (!area) {
      area = create("div", { id: "print-area" });
      document.body.appendChild(area);
    }
    area.className = "fs-" + Store.getFontSize();
    var clone = el("exam-modal-body").cloneNode(true);
    $all(".print-check", clone).forEach(function (n) { n.parentNode.removeChild(n); });
    $all(".exam-section", clone).forEach(function (sec) {
      $all(".exam-field-sep", sec).forEach(function (h) { h.parentNode.removeChild(h); });
      var kept = [];
      $all(".exam-field", sec).forEach(function (f) {
        if (Store.isPrintSection(f.getAttribute("data-sectype"))) kept.push(f);
        else f.parentNode.removeChild(f);
      });
      // 残ったセクション間に区切り線を入れ直す
      kept.forEach(function (f, i) {
        if (i > 0) {
          var hr = document.createElement("hr");
          hr.className = "exam-hr exam-field-sep";
          f.parentNode.insertBefore(hr, f);
        }
      });
      if (!kept.length) sec.parentNode.removeChild(sec);
    });
    area.innerHTML = '<h1 class="print-title">' + esc(el("exam-modal-title").textContent) + "</h1>" +
      clone.innerHTML;
    window.print();
  }

  // コピー: 表示中の本文テキストをクリップボードへ
  function copyExam() {
    var text = el("exam-modal-title").textContent + "\n\n" + el("exam-modal-body").innerText;
    var done = function () { UI.toast("コピーしました", "ok"); };
    var fail = function () { UI.toast("コピーに失敗しました", "err"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text) ? done() : fail(); });
    } else {
      legacyCopy(text) ? done() : fail();
    }
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  // 本文・和訳・全訳セクション（段落番号 [1] と字下げを有効にする）
  function isBodySection(label) { return label === "本文" || /全訳|和訳|訳/.test(label); }
  // 英単語数は共有モジュール Difficulty を使用
  function wordCount(text) { return Difficulty.wordCount(text); }
  function markupOpts(label) {
    var body = isBodySection(label);
    return { paraNum: body, zenyaku: label === "全訳" };
  }
  function renderField(label, icon, text) {
    var body = isBodySection(label);
    var r = Markup.render(text, markupOpts(label));
    var checked = Store.isPrintSection(label) ? " checked" : "";
    var wc = "";
    if (label === "本文") {
      var d = sectionDifficulty(text);
      wc = '<div class="word-count">(' + wordCount(text) + " words)" +
        (d.score ? ' <span class="level-inline" title="難易度（合成スコア）">' + esc(d.score.toFixed(1)) + " " + esc(d.band) + "</span>" : "") +
        "</div>";
    }
    return '<div class="exam-field" data-sectype="' + esc(label) + '" style="margin-bottom:14px">' +
      '<div class="exam-section-title">' + esc(label) +
      '<label class="print-check" title="チェックした項目のみ印刷されます">' +
      '<input type="checkbox" data-printsec="' + esc(label) + '"' + checked + '><span>印刷</span></label>' +
      "</div>" +
      '<div class="exam-doc' + (body ? "" : " no-indent") + '">' + r.html + wc + "</div></div>";
  }

  /* ---------------- 問題印刷タブ ---------------- */
  // 解答面に回すセクション種別（それ以外は問題面）
  function isAnswerSide(type) { return /解答|解説|和訳|訳|答|講評/.test(type); }

  // 1大問のセクション一覧（problem_text の {{セクション}} ＋ 旧カラム互換）
  function questionSections(q) {
    var sections = Markup.parseSections(q.problem_text || "");
    var hasAns = sections.some(function (s) { return s.type === "解答"; });
    var hasCom = sections.some(function (s) { return s.type === "解説"; });
    if (q.answer_text && q.answer_text.trim() && !hasAns) sections.push({ type: "解答", text: q.answer_text });
    if (q.commentary_text && q.commentary_text.trim() && !hasCom) sections.push({ type: "解説", text: q.commentary_text });
    return sections;
  }

  function printField(label, text) {
    var body = isBodySection(label);
    return '<div class="print-field"><div class="print-field-label">' + esc(label) + "</div>" +
      '<div class="exam-doc' + (body ? "" : " no-indent") + '">' + Markup.render(text, markupOpts(label)).html + "</div></div>";
  }

  // 印刷ドキュメントの HTML を構築（表紙 → 問題面 → 解答面）
  // 大問が印刷対象か（未設定＝デフォルトで対象。明示的に false のときのみ除外）
  function isPrintQ(qnum) {
    return state.printQSel[String(qnum)] !== false;
  }

  function buildPrintHtml(ex, opts) {
    var html = "";
    if (opts.cover) {
      html += '<div class="print-cover">' +
        '<div class="pc-year">' + esc(ex.year) + "年度</div>" +
        '<div class="pc-uni">' + esc(ex.university_name) + "</div>" +
        '<div class="pc-sched">' + esc(ex.schedule) + "</div></div>";
    }
    var qs = (ex.questions || []).slice().sort(function (a, b) {
      return (Number(a.question_number) || 0) - (Number(b.question_number) || 0);
    }).filter(function (q) { return isPrintQ(q.question_number); });
    function part(title, answerSide) {
      var inner = "";
      qs.forEach(function (q) {
        var secs = questionSections(q).filter(function (s) {
          return s.text && s.text.trim() && (isAnswerSide(s.type) === answerSide) && Store.isPrintSection(s.type);
        });
        if (!secs.length) return;
        inner += '<div class="print-q"><div class="print-q-head">大問' + esc(qLabel(q)) + "</div>";
        secs.forEach(function (s) { inner += printField(s.type, s.text); });
        inner += "</div>";
      });
      if (!inner) return "";
      return '<div class="print-part"><div class="print-part-head">' + esc(title) + "</div>" + inner + "</div>";
    }
    html += part("問題", false);
    html += part("解答・解説", true);
    return html;
  }

  function printOptions() {
    return { cover: el("pr-cover").checked };
  }

  // 選択中の試験から登場するセクション種別を問題面／解答面に分けてチェックUI化。
  // チェック状態はモーダル印刷と共通の Store.isPrintSection を用いる。
  function renderPrintSectionControls() {
    var box = el("pr-sections");
    if (!state.printExam) { box.innerHTML = ""; return; }
    var problem = [], answer = [];
    (state.printExam.questions || []).forEach(function (q) {
      questionSections(q).forEach(function (s) {
        if (!s.text || !s.text.trim()) return;
        var arr = isAnswerSide(s.type) ? answer : problem;
        if (arr.indexOf(s.type) < 0) arr.push(s.type);
      });
    });
    function group(title, types) {
      if (!types.length) return "";
      var h = '<div class="pr-secgroup"><div class="pr-secgroup-head">' + esc(title) + "</div>" +
        '<div class="pr-secgroup-opts">';
      types.forEach(function (t) {
        var ck = Store.isPrintSection(t) ? " checked" : "";
        h += '<label class="check-inline"><input type="checkbox" data-prsec="' + esc(t) + '"' + ck + "> <span>" + esc(t) + "</span></label>";
      });
      return h + "</div></div>";
    }
    // 印刷する大問の選択（セクション選択の上に置く）
    function qgroup() {
      var qs = (state.printExam.questions || []).slice().sort(function (a, b) {
        return (Number(a.question_number) || 0) - (Number(b.question_number) || 0);
      });
      if (!qs.length) return "";
      var h = '<div class="pr-secgroup"><div class="pr-secgroup-head">印刷する大問</div>' +
        '<div class="pr-secgroup-opts">';
      qs.forEach(function (q) {
        var ck = isPrintQ(q.question_number) ? " checked" : "";
        h += '<label class="check-inline"><input type="checkbox" data-prq="' + esc(String(q.question_number)) + '"' + ck +
          "> <span>大問" + esc(qLabel(q)) + "</span></label>";
      });
      return h + "</div></div>";
    }
    var html = qgroup() + group("問題面に印刷するセクション", problem) + group("解答面に印刷するセクション", answer);
    box.innerHTML = html ? '<div class="card pr-seccard">' + html + "</div>" : "";
    $all("[data-prq]", box).forEach(function (cb) {
      cb.addEventListener("change", function () {
        state.printQSel[cb.getAttribute("data-prq")] = cb.checked;
        renderPrintPreview();
      });
    });
    $all("[data-prsec]", box).forEach(function (cb) {
      cb.addEventListener("change", function () {
        Store.setPrintSection(cb.getAttribute("data-prsec"), cb.checked);
        renderPrintPreview();
      });
    });
  }

  // 印刷タブを開いたとき：ツリー（大学→年度→方式）とプレビューを用意
  function openPrintTab() {
    loadPrintTree();
    loadPrintPreview();
  }

  // 印刷タブのツリー（大学→年度→方式まで。方式クリックで全大問プレビュー）
  function loadPrintTree(force) {
    var box = el("pr-tree");
    if (!box) return;
    if (!Store.getWorkerUrl()) { box.innerHTML = ""; return; }
    if (state.printTreeLoaded && !force) return;
    box.innerHTML = '<div class="tree-msg"><span class="spinner"></span> 読み込み中…</div>';
    Api.getExams({}).then(function (data) {
      var exams = data.exams || [];
      if (!exams.length) { box.innerHTML = '<div class="tree-msg">登録された入試問題がありません。</div>'; return; }
      var unis = {};
      exams.forEach(function (e) {
        var u = e.university_name || "（大学名なし）", y = String(e.year), s = e.schedule || "（方式なし）";
        if (e.university_reading) state.uniReading[u] = e.university_reading;
        if (!unis[u]) unis[u] = {};
        if (!unis[u][y]) unis[u][y] = {};
        unis[u][y][s] = true;
      });
      var html = '<div class="tree">';
      Object.keys(unis).sort(uniCmp).forEach(function (u) {
        html += '<div class="tree-node">' + treeRow("uni", "fa-building-columns", esc(u)) + '<div class="tree-children" hidden>';
        Object.keys(unis[u]).sort(function (a, b) { return Number(b) - Number(a); }).forEach(function (y) {
          html += '<div class="tree-node">' + treeRow("year", "fa-calendar-days", esc(y) + "年度") + '<div class="tree-children" hidden>';
          Object.keys(unis[u][y]).sort(function (a, b) { return (schedOrder(a) - schedOrder(b)) || a.localeCompare(b, "ja"); }).forEach(function (s) {
            var picked = (state.printSel.uni === u && state.printSel.year === y && state.printSel.sched === s);
            html += '<button type="button" class="tree-row tree-row-sched tree-row-pick' + (picked ? " selected" : "") + '"' +
              ' data-uni="' + esc(u) + '" data-year="' + esc(y) + '" data-sched="' + esc(s) + '">' +
              '<i class="fa-solid fa-layer-group tree-ic"></i><span class="tree-label">' + esc(s) + "</span></button>";
          });
          html += "</div></div>";
        });
        html += "</div></div>";
      });
      html += "</div>";
      box.innerHTML = html;
      state.printTreeLoaded = true;
      wirePrintTree();
    }).catch(function (e) {
      box.innerHTML = '<div class="tree-msg">' + esc(e.message) + "</div>";
    });
  }

  function wirePrintTree() {
    var box = el("pr-tree");
    $all(".tree-row", box).forEach(function (row) {
      row.addEventListener("click", function () {
        if (row.classList.contains("tree-row-pick")) {
          $all(".tree-row-pick", box).forEach(function (x) { x.classList.remove("selected"); });
          row.classList.add("selected");
          state.printSel = { uni: row.getAttribute("data-uni"), year: row.getAttribute("data-year"), sched: row.getAttribute("data-sched") };
          loadPrintPreview();
          return;
        }
        var children = row.nextElementSibling;
        if (!children || !children.classList.contains("tree-children")) return;
        var willOpen = children.hidden;
        children.hidden = !willOpen;
        row.classList.toggle("open", willOpen);
      });
    });
  }

  function loadPrintPreview() {
    if (!Store.getWorkerUrl()) { el("print-preview").innerHTML = noWorkerHtml(); return; }
    var sel = state.printSel || {};
    var year = sel.year, uni = sel.uni, sched = sel.sched;
    if (!year || !uni || !sched) {
      state.printExam = null;
      renderPrintSectionControls();
      el("print-preview").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-print ic"></i>上のツリーから 大学 → 年度 → 方式 を選んでください。</div></div>';
      return;
    }
    el("print-preview").innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> 読み込み中…</div></div>';
    Api.getExams({ universityName: uni, year: year, schedule: sched }).then(function (data) {
      var exams = (data.exams || []).filter(function (e) { return e.university_name === uni && String(e.year) === String(year) && e.schedule === sched; });
      if (!exams.length) {
        state.printExam = null;
        renderPrintSectionControls();
        el("print-preview").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>該当する入試問題がありません。</div></div>';
        return;
      }
      return Promise.all(exams.map(function (e) { return Api.getExam(e.id); })).then(function (results) {
        var questions = [];
        results.forEach(function (r) { (r.exam.questions || []).forEach(function (q) { questions.push(q); }); });
        state.printExam = { year: year, university_name: uni, schedule: sched, questions: questions };
        // 大問選択を初期化（既定で全大問を印刷対象に）
        state.printQSel = {};
        questions.forEach(function (q) { state.printQSel[String(q.question_number)] = true; });
        renderPrintSectionControls();
        renderPrintPreview();
      });
    }).catch(function (e) {
      el("print-preview").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div></div>";
    });
  }

  function renderPrintPreview() {
    if (!state.printExam) return;
    var html = buildPrintHtml(state.printExam, printOptions());
    if (!html) { el("print-preview").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>印刷対象がありません。チェックや登録内容を確認してください。</div></div>'; return; }
    el("print-preview").innerHTML = '<div class="print-doc fs-' + Store.getPrintFontSize() + " lh-" + Store.getPrintLineHeight() + '">' + html + "</div>";
  }

  function runPrint() {
    if (!state.printExam) { UI.toast("印刷対象がありません", "err"); return; }
    var html = buildPrintHtml(state.printExam, printOptions());
    if (!html) { UI.toast("印刷対象がありません", "err"); return; }
    var area = el("print-area");
    if (!area) { area = create("div", { id: "print-area" }); document.body.appendChild(area); }
    area.className = "print-out fs-" + Store.getPrintFontSize() + " lh-" + Store.getPrintLineHeight();
    area.innerHTML = html;
    window.print();
  }

  /* ---------------- コーパス対象絞り込み ---------------- */
  var CF_GROUPS = [
    { key: "universities", label: "大学", field: "university_name" },
    { key: "years",        label: "年度", field: "year" },
    { key: "schedules",    label: "方式", field: "schedule" },
    { key: "categories",   label: "種別", field: "category" },
    { key: "sections",     label: "セクション", field: "__section__" }
  ];

  // 全問題に含まれるセクション種別を収集（問題・本文・設問・解答・解説・全訳 を優先順に）
  function corpusSectionTypes(qs) {
    var set = [];
    qs.forEach(function (q) {
      var types = Markup.parseSections(q.problem_text || "").map(function (s) { return s.type; });
      if (q.answer_text && q.answer_text.trim() && types.indexOf("解答") < 0) types.push("解答");
      if (q.commentary_text && q.commentary_text.trim() && types.indexOf("解説") < 0) types.push("解説");
      types.forEach(function (t) { if (set.indexOf(t) < 0) set.push(t); });
    });
    var order = ["問題", "本文", "設問", "解答", "解説", "全訳"];
    set.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = 999; if (ib < 0) ib = 999;
      return ia - ib || a.localeCompare(b, "ja");
    });
    return set;
  }

  // 1問題の選択セクションだけを連結して記法除去（secSet=null は全セクション）
  function questionSectionText(q, secSet) {
    var sections = Markup.parseSections(q.problem_text || "");
    var hasAns = sections.some(function (s) { return s.type === "解答"; });
    var hasCom = sections.some(function (s) { return s.type === "解説"; });
    if (q.answer_text && q.answer_text.trim() && !hasAns) sections.push({ type: "解答", text: q.answer_text });
    if (q.commentary_text && q.commentary_text.trim() && !hasCom) sections.push({ type: "解説", text: q.commentary_text });
    var parts = [];
    sections.forEach(function (s) { if (!secSet || secSet.indexOf(s.type) >= 0) parts.push(s.text); });
    return Markup.strip(parts.join("\n"));
  }

  function applyCorpusFilter(qs) {
    var f = state.corpusFilter;
    return qs.filter(function (q) {
      if (f.universities && f.universities.indexOf(String(q.university_name)) < 0) return false;
      if (f.years && f.years.indexOf(String(q.year)) < 0) return false;
      if (f.schedules && f.schedules.indexOf(String(q.schedule)) < 0) return false;
      if (f.categories && f.categories.indexOf(String(q.category || "")) < 0) return false;
      return true;
    });
  }

  function cfLabel(field, v) {
    if (field === "year") return v + "年";
    return v;
  }

  function openCorpusFilter() {
    if (!Store.getWorkerUrl()) { UI.toast("Worker URL が未設定です", "err"); return; }
    UI.openModal(el("corpus-filter-modal"));
    el("corpus-filter-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    var p = state.corpus ? Promise.resolve({ questions: state.corpus }) : Api.getCorpus();
    p.then(function (data) {
      state.corpus = data.questions || [];
      renderCorpusFilterBody();
    }).catch(function (e) {
      el("corpus-filter-body").innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div>";
    });
  }

  function renderCorpusFilterBody() {
    var qs = state.corpus || [];
    if (!qs.length) {
      el("corpus-filter-body").innerHTML = '<div class="empty"><i class="fa-solid fa-inbox ic"></i>入試問題が登録されていません。</div>';
      return;
    }
    var html = "";
    CF_GROUPS.forEach(function (g) {
      var vals = [];
      if (g.field === "__section__") {
        vals = corpusSectionTypes(qs);
      } else {
        qs.forEach(function (q) {
          var v = (q[g.field] != null && q[g.field] !== "") ? String(q[g.field]) : null;
          if (v !== null && vals.indexOf(v) < 0) vals.push(v);
        });
        if (g.field === "year") vals.sort(function (a, b) { return Number(b) - Number(a); });
        else vals.sort();
      }
      var sel = state.corpusFilter[g.key];
      html += '<div class="cf-group"><div class="cf-group-head">' +
        '<span class="field-label">' + esc(g.label) + "</span>" +
        '<button class="btn ghost sm" data-cftoggle="' + g.key + '">全選択/解除</button>' +
        "</div>" + '<div class="cf-options">';
      vals.forEach(function (v) {
        var checked = (sel == null || sel.indexOf(v) >= 0) ? " checked" : "";
        html += '<label><input type="checkbox" data-cfgroup="' + esc(g.key) + '" value="' + esc(v) + '"' + checked + ">" +
          esc(cfLabel(g.field, v)) + "</label>";
      });
      html += "</div></div>";
    });
    el("corpus-filter-body").innerHTML = html;
    $all("[data-cftoggle]", el("corpus-filter-body")).forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-cftoggle");
        var boxes = $all('[data-cfgroup="' + key + '"]', el("corpus-filter-body"));
        var allChecked = boxes.every(function (x) { return x.checked; });
        boxes.forEach(function (x) { x.checked = !allChecked; });
      });
    });
  }

  function applyCorpusFilterModal() {
    var f = {}, missing = null;
    CF_GROUPS.forEach(function (g) {
      var boxes = $all('[data-cfgroup="' + g.key + '"]', el("corpus-filter-body"));
      if (!boxes.length) { f[g.key] = null; return; }
      var checked = [];
      boxes.forEach(function (b) { if (b.checked) checked.push(b.value); });
      if (!checked.length) missing = g.label;
      // 全選択は「制限なし」として保持（新規登録分も自動で対象に含める）
      f[g.key] = (checked.length === boxes.length) ? null : checked;
    });
    if (missing) { UI.toast(missing + " を1つ以上選択してください", "err"); return; }
    state.corpusFilter = f;
    UI.closeModal(el("corpus-filter-modal"));
    updateCorpusFilterSummary();
    if (state.corpus) analyzeCorpus();
  }

  function updateCorpusFilterSummary() {
    var f = state.corpusFilter, parts = [];
    CF_GROUPS.forEach(function (g) {
      var sel = f[g.key];
      if (sel == null) return;
      var labels = sel.map(function (v) { return cfLabel(g.field, v); });
      parts.push(g.label + ": " + (labels.length <= 4 ? labels.join("・") : labels.slice(0, 4).join("・") + " ほか" + (labels.length - 4) + "件"));
    });
    el("corpus-filter-summary").innerHTML = '<i class="fa-solid fa-filter"></i> 対象: ' +
      (parts.length ? esc(parts.join(" / ")) : "すべての入試問題");
  }

  /* ---------------- コーパス分析 ---------------- */
  function ensureCorpusControls() {
    // ストップワード（Worker 内蔵＋共有リスト）
    var sw = el("corpus-stopword");
    var swSel = sw.value;
    sw.innerHTML = '<option value="">なし（除外しない）</option>';
    Store.getStopLists().forEach(function (l, i) {
      var o = create("option"); o.value = String(i); o.textContent = l.name + "（" + l.words.length + "語）"; sw.appendChild(o);
    });
    if (sw.querySelector('option[value="0"]') && swSel === "") sw.value = "0"; else sw.value = swSel;

    // 語彙リスト（カバー率。内蔵 Target1900＋localStorage。既定は内蔵）
    var vc = el("corpus-vocab");
    var vcSel = vc.value;
    vc.innerHTML = '<option value="">なし</option>';
    Store.getVocabLists().forEach(function (l, i) {
      var o = create("option"); o.value = String(i); o.textContent = l.name + "（" + l.words.length + "語）"; vc.appendChild(o);
    });
    if (vc.querySelector('option[value="0"]') && vcSel === "") vc.value = "0"; else vc.value = vcSel;

    // レベル別語彙リスト（CEFR分析。Worker 内蔵＋共有リスト。既定は内蔵）
    var lv = el("corpus-level");
    var lvSel = lv.value;
    lv.innerHTML = '<option value="">なし</option>';
    Store.getLevelLists().forEach(function (l, i) {
      var n = Object.keys(l.levels || {}).length;
      var o = create("option"); o.value = String(i); o.textContent = l.name + "（" + n + "語）"; lv.appendChild(o);
    });
    if (lv.querySelector('option[value="0"]') && lvSel === "") lv.value = "0"; else lv.value = lvSel;
  }

  // コーパスタブ表示時に Worker から共有リストを取り込んでから選択肢を再構築
  function refreshCorpusLists() {
    return Store.hydrateWordLists().then(ensureCorpusControls, ensureCorpusControls);
  }

  function runCorpus() {
    if (!Store.getWorkerUrl()) { el("corpus-results").innerHTML = noWorkerHtml(); return; }
    el("corpus-results").innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> コーパスを取得・分析中…</div></div>';
    var p = state.corpus ? Promise.resolve({ questions: state.corpus }) : Api.getCorpus();
    p.then(function (data) {
      state.corpus = data.questions || [];
      analyzeCorpus();
    }).catch(function (e) {
      el("corpus-results").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div></div>";
    });
  }

  function analyzeCorpus() {
    var qs = applyCorpusFilter(state.corpus || []);
    if (!qs.length) {
      el("corpus-results").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-filter ic"></i>絞り込み条件に該当する入試問題がありません。「対象を絞り込み」から条件を見直してください。</div></div>';
      return;
    }
    // ドキュメント（KWIC用ラベル付き）と全文。選択セクションのみ対象。
    var secSet = state.corpusFilter.sections;  // 配列 or null（全セクション）
    var docs = qs.map(function (q) {
      return { text: questionSectionText(q, secSet), label: q.year + " " + q.university_name + " 大問" + qLabel(q) };
    }).filter(function (d) { return d.text.trim(); });
    var fullText = docs.map(function (d) { return d.text; }).join("\n");
    var tokens = Corpus.tokenize(fullText);

    if (!docs.length || !tokens.length) {
      el("corpus-results").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>選択したセクションに英文テキストが見つかりませんでした。「対象を絞り込み」のセクション選択を見直してください。</div></div>';
      return;
    }

    var swIdx = el("corpus-stopword").value;
    var stopSet = swIdx !== "" ? Corpus.toSet(Store.getStopLists()[Number(swIdx)].words) : null;
    var vcIdx = el("corpus-vocab").value;
    var vocab = vcIdx !== "" ? Store.getVocabLists()[Number(vcIdx)] : null;
    var lvIdx = el("corpus-level").value;
    var levelList = lvIdx !== "" ? Store.getLevelLists()[Number(lvIdx)] : null;
    var word = el("corpus-word").value.trim();

    var st = Corpus.stats(fullText, tokens);
    var freq = Corpus.frequency(tokens, stopSet);
    var bigrams = Corpus.ngrams(tokens, 2, stopSet);
    var trigrams = Corpus.ngrams(tokens, 3, stopSet);

    var html = "";

    // --- 統計 ---
    html += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-chart-simple ic"></i> 語数・難易度統計</h3>' +
      '<span class="spacer"></span><span class="hint">対象 ' + docs.length + ' 大問</span></div>' +
      '<div class="stat-grid">' +
      stat(st.tokens, "総語数 (tokens)") +
      stat(st.types, "異なり語数 (types)") +
      stat(st.ttr.toFixed(3), "TTR (type/token)") +
      stat(st.sentences, "文数") +
      stat(st.avgSentenceLen.toFixed(1), "平均文長 (語)") +
      stat(st.avgWordLen.toFixed(2), "平均語長 (文字)") +
      "</div></div>";

    // --- 頻度リスト + チャート ---
    html += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-ranking-star ic"></i> 頻度リスト' +
      (stopSet ? "（ストップワード除外）" : "") + "</h3></div>" +
      '<canvas id="freq-chart" height="120"></canvas>' +
      '<div class="table-wrap" style="margin-top:14px"><table class="data freq-table"><thead><tr>' +
      "<th>#</th><th>語</th><th>頻度</th><th>分布</th></tr></thead><tbody>";
    var top = freq.slice(0, 40);
    var maxc = top.length ? top[0].count : 1;
    top.forEach(function (f, i) {
      html += "<tr><td class='num'>" + (i + 1) + "</td><td><strong>" + esc(f.word) + "</strong></td>" +
        "<td class='num'>" + f.count + "</td>" +
        '<td><div class="bar-track"><div class="bar" style="width:' + Math.max(4, (f.count / maxc * 100)) + '%"></div></div></td></tr>';
    });
    html += "</tbody></table></div></div>";

    // --- KWIC ---
    if (word) {
      var lines = Corpus.kwic(docs, word, 7);
      html += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-align-center ic"></i> KWIC コンコーダンス: 「' + esc(word) + '」</h3>' +
        '<span class="spacer"></span><span class="pill em">' + lines.length + ' 件</span></div>';
      if (!lines.length) html += '<div class="empty">「' + esc(word) + '」は見つかりませんでした。</div>';
      else {
        html += "<div>";
        lines.slice(0, 200).forEach(function (l) {
          html += '<div class="kwic-line"><span class="kwic-left">' + esc(l.left) + '</span>' +
            '<span class="kwic-key">' + esc(l.key) + '</span>' +
            '<span class="kwic-right">' + esc(l.right) + '</span>' +
            '<span class="kwic-src">' + esc(l.label) + '</span></div>';
        });
        html += "</div>";
      }
      html += "</div>";
    }

    // --- n-gram ---
    html += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-link ic"></i> n-gram（連語）</h3></div><div class="grid-2">';
    html += ngramTable("2-gram（バイグラム）", bigrams);
    html += ngramTable("3-gram（トライグラム）", trigrams);
    html += "</div></div>";

    // --- 語彙カバー率 ---
    if (vocab) {
      var covTokens = stopSet ? tokens.filter(function (w) { return !stopSet[w]; }) : tokens;
      var cov = Corpus.coverage(covTokens, Corpus.toSet(vocab.words));
      state.covOffList = cov.offList;
      state.covListName = vocab.name;
      html += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-list-check ic"></i> 語彙カバー率: ' + esc(vocab.name) +
        (stopSet ? "（ストップワード除外）" : "") + '</h3><span class="spacer"></span><span class="hint">タップでその他の語一覧</span></div>' +
        '<div class="grid-2"><div><canvas id="cov-chart" height="160"></canvas></div>' +
        '<div class="stat-grid">' +
        stat((cov.tokenCoverage * 100).toFixed(1) + "%", "延べ語カバー率") +
        stat((cov.typeCoverage * 100).toFixed(1) + "%", "異なり語カバー率") +
        stat(cov.tokenHead, "見出し語 (延べ)") +
        stat(cov.tokenDerived, "派生語 (延べ)") +
        stat(cov.tokenInList, "リスト内 (延べ)") +
        stat(cov.offList.length, "その他 異なり語") +
        "</div></div>";
      html += '<div class="table-wrap" style="margin-top:14px"><table class="data freq-table"><tbody>' +
        '<tr class="level-row" data-covoff="1" style="cursor:pointer">' +
        '<td><span class="level-badge" style="background:#cbd5e1;color:#334155">その他（リスト外）</span></td>' +
        "<td class='num'>" + cov.offList.length + " 異なり語</td>" +
        '<td class="hint"><i class="fa-solid fa-arrow-up-right-from-square"></i> タップで全一覧</td>' +
        "</tr></tbody></table></div></div>";
    }

    // --- 語彙レベル分析（CEFR） ---
    var lvStats = null;
    if (levelList) {
      lvStats = Corpus.levelStats(tokens, levelList.levels || {});
      state.levelStats = lvStats;
      state.levelListName = levelList.name;
      html += renderLevelSection(lvStats, levelList.name);
    }

    el("corpus-results").innerHTML = html;

    // チャート描画
    destroyCharts();
    drawFreqChart(top);
    if (vocab) drawCovChart(Corpus.coverage(covTokens, Corpus.toSet(vocab.words)));
    if (lvStats) drawLevelChart(lvStats);

    // レベル詳細モーダルを開く（行タップ）
    $all("[data-level]", el("corpus-results")).forEach(function (b) {
      b.addEventListener("click", function () { openLevelDetail(b.getAttribute("data-level")); });
    });
    // 語彙カバー率「その他（リスト外）」一覧をモーダルで開く
    $all("[data-covoff]", el("corpus-results")).forEach(function (b) {
      b.addEventListener("click", openCovOffDetail);
    });
  }

  function openCovOffDetail() {
    var words = state.covOffList || [];
    el("level-detail-title").innerHTML = '<span class="level-badge" style="background:#cbd5e1;color:#334155">その他（リスト外）</span> ' +
      words.length + " 語（" + esc(state.covListName || "") + "）";
    var body = '<div class="table-wrap"><table class="data freq-table"><thead><tr><th>#</th><th>語</th><th>頻度</th></tr></thead><tbody>';
    if (!words.length) body += '<tr><td colspan="3" class="hint">該当する語はありません。</td></tr>';
    words.forEach(function (w, i) {
      body += "<tr><td class='num'>" + (i + 1) + "</td><td><strong>" + esc(w.word) + "</strong></td><td class='num'>" + w.count + "</td></tr>";
    });
    body += "</tbody></table></div>";
    el("level-detail-body").innerHTML = body;
    UI.openModal(el("level-detail-modal"));
  }

  // CEFR レベルごとの色（A1=易→C2=難）
  var LEVEL_COLORS = {
    A1: "#34d399", A2: "#10b981", B1: "#3b82f6", B2: "#6366f1",
    C1: "#a855f7", C2: "#ec4899", off: "#cbd5e1"
  };
  function renderLevelSection(s, listName) {
    var inTok = s.tokenInLevel || 0;
    var h = '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-layer-group ic"></i> 語彙レベル分析: ' +
      esc(listName) + "</h3><span class=\"spacer\"></span><span class=\"hint\">タップで各レベルの語一覧</span></div>" +
      '<div class="grid-2"><div><canvas id="level-chart" height="200"></canvas></div>' +
      '<div class="stat-grid">' +
      stat((s.tokenTotal ? (inTok / s.tokenTotal * 100) : 0).toFixed(1) + "%", "リスト収録率（延べ）") +
      stat(inTok, "リスト内 (延べ)") +
      stat(s.tokenOff, "リスト外 (延べ)") +
      stat(s.offTypes, "リスト外 異なり語") +
      "</div></div>";
    // レベル別テーブル（延べ語比率つき・行タップで詳細）
    h += '<div class="table-wrap" style="margin-top:14px"><table class="data freq-table"><thead><tr>' +
      "<th>レベル</th><th>延べ語</th><th>異なり語</th><th>延べ比率</th><th>分布</th></tr></thead><tbody>";
    s.perLevel.forEach(function (lv) {
      var pct = s.tokenTotal ? (lv.tokens / s.tokenTotal * 100) : 0;
      h += '<tr class="level-row" data-level="' + esc(lv.level) + '" style="cursor:pointer">' +
        '<td><span class="level-badge" style="background:' + LEVEL_COLORS[lv.level] + '">' + esc(lv.level) + "</span></td>" +
        "<td class='num'>" + lv.tokens + "</td><td class='num'>" + lv.types + "</td>" +
        "<td class='num'>" + pct.toFixed(1) + "%</td>" +
        '<td><div class="bar-track"><div class="bar" style="width:' + Math.max(2, pct) + "%;background:" + LEVEL_COLORS[lv.level] + '"></div></div></td></tr>';
    });
    var offPct = s.tokenTotal ? (s.tokenOff / s.tokenTotal * 100) : 0;
    h += '<tr class="level-row" data-level="off" style="cursor:pointer">' +
      '<td><span class="level-badge" style="background:' + LEVEL_COLORS.off + ';color:#334155">リスト外</span></td>' +
      "<td class='num'>" + s.tokenOff + "</td><td class='num'>" + s.offTypes + "</td>" +
      "<td class='num'>" + offPct.toFixed(1) + "%</td>" +
      '<td><div class="bar-track"><div class="bar" style="width:' + Math.max(2, offPct) + "%;background:" + LEVEL_COLORS.off + '"></div></div></td></tr>';
    h += "</tbody></table></div></div>";
    return h;
  }

  function openLevelDetail(level) {
    var s = state.levelStats; if (!s) return;
    var words, title;
    if (level === "off") {
      words = s.off;
      title = "リスト外の語（" + esc(state.levelListName || "") + "）";
    } else {
      var lv = null;
      s.perLevel.forEach(function (p) { if (p.level === level) lv = p; });
      words = lv ? lv.words : [];
      title = level + " の語（" + esc(state.levelListName || "") + "）";
    }
    el("level-detail-title").innerHTML = '<span class="level-badge" style="background:' +
      (LEVEL_COLORS[level] || LEVEL_COLORS.off) + (level === "off" ? ";color:#334155" : "") + '">' +
      (level === "off" ? "リスト外" : esc(level)) + "</span> " + (words.length) + " 語";
    var body = '<div class="table-wrap"><table class="data freq-table"><thead><tr><th>#</th><th>語</th><th>頻度</th></tr></thead><tbody>';
    if (!words.length) body += '<tr><td colspan="3" class="hint">該当する語はありません。</td></tr>';
    words.forEach(function (w, i) {
      body += "<tr><td class='num'>" + (i + 1) + "</td><td><strong>" + esc(w.word) + "</strong></td><td class='num'>" + w.count + "</td></tr>";
    });
    body += "</tbody></table></div>";
    el("level-detail-body").innerHTML = body;
    UI.openModal(el("level-detail-modal"));
  }

  function drawLevelChart(s) {
    var ctx = el("level-chart"); if (!ctx || !global.Chart) return;
    var labels = [], data = [], colors = [];
    s.perLevel.forEach(function (lv) {
      if (lv.tokens > 0) { labels.push(lv.level); data.push(lv.tokens); colors.push(LEVEL_COLORS[lv.level]); }
    });
    if (s.tokenOff > 0) { labels.push("リスト外"); data.push(s.tokenOff); colors.push(LEVEL_COLORS.off); }
    state.charts.level = new Chart(ctx, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors }] },
      options: { plugins: { legend: { position: "bottom" } } }
    });
  }

  function stat(n, k) { return '<div class="stat"><div class="n">' + esc(n) + '</div><div class="k">' + esc(k) + "</div></div>"; }
  function ngramTable(title, list) {
    var h = '<div><div class="exam-section-title" style="font-family:var(--sans)">' + esc(title) + "</div>" +
      '<div class="table-wrap"><table class="data freq-table" style="min-width:auto"><tbody>';
    if (!list.length) h += '<tr><td class="hint">繰り返し出現する連語はありません。</td></tr>';
    list.slice(0, 15).forEach(function (g) {
      h += "<tr><td>" + esc(g.gram) + "</td><td class='num'>" + g.count + "</td></tr>";
    });
    h += "</tbody></table></div></div>";
    return h;
  }

  function destroyCharts() {
    Object.keys(state.charts).forEach(function (k) { if (state.charts[k]) state.charts[k].destroy(); });
    state.charts = {};
  }
  function drawFreqChart(top) {
    var ctx = el("freq-chart"); if (!ctx || !global.Chart) return;
    var d = top.slice(0, 15);
    state.charts.freq = new Chart(ctx, {
      type: "bar",
      data: { labels: d.map(function (x) { return x.word; }),
        datasets: [{ label: "頻度", data: d.map(function (x) { return x.count; }),
          backgroundColor: "rgba(5,150,105,.75)", borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }
  function drawCovChart(cov) {
    var ctx = el("cov-chart"); if (!ctx || !global.Chart) return;
    state.charts.cov = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["見出し語", "派生語", "その他"],
        datasets: [{ data: [cov.tokenHead, cov.tokenDerived, cov.tokenTotal - cov.tokenInList],
          backgroundColor: ["rgba(5,150,105,.85)", "rgba(16,185,129,.45)", "rgba(37,99,235,.2)"] }] },
      options: { plugins: { legend: { position: "bottom" } } }
    });
  }

  var global = window;
  document.addEventListener("DOMContentLoaded", init);
})();
