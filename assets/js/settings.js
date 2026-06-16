/* =====================================================================
   settings.js — 設定ページ (setting/index.html) のロジック
   ===================================================================== */
(function () {
  "use strict";
  var el = UI.el, $ = UI.$, $all = UI.$all, create = UI.create, esc = UI.escapeHtml, toast = UI.toast;

  var SET_TABS = {
    main:     { id: "main",     label: "メイン設定",       icon: "fa-sliders" },
    conn:     { id: "conn",     label: "接続設定",         icon: "fa-plug" },
    list:     { id: "list",     label: "入試問題一覧",     icon: "fa-table-list" },
    register: { id: "register", label: "問題登録",         icon: "fa-pen-to-square" },
    ingest:   { id: "ingest",   label: "PDF取り込み",      icon: "fa-file-import" },
    corpus:   { id: "corpus",   label: "コーパス検索設定", icon: "fa-language" }
  };
  var SET_ORDER = ["main", "conn", "list", "register", "ingest", "corpus"];
  var MAIN_TABS = { search: { label: "通常検索", icon: "fa-table-list" }, corpus: { label: "コーパス検索", icon: "fa-language" }, print: { label: "問題印刷", icon: "fa-print" } };
  var MAIN_ORDER = ["search", "corpus", "print"];

  var state = {
    config: { schedules: [], year_presets: [], question_categories: [], section_types: [] },
    universities: [],
    list: { filter: { word: "", universityName: "", year: "", schedule: "", qnum: "", category: "" }, rows: [], sortedRows: [], sort: { key: "year", dir: "desc" }, nav: { examId: null, qnum: null } },
    reg: { sections: [], editingExamId: null, meta: { year: "", university: "", schedule: "", qnum: "1", category: "" } },
    editCtx: null  // 汎用編集モーダルの対象
  };

  /* ---------------- 初期化 ---------------- */
  function init() {
    el("site-title").textContent = Store.getSiteTitle();
    el("site-subtitle").textContent = Store.getSiteSubtitle();
    document.title = "設定 — " + Store.getSiteTitle();
    UI.applyDomainLinks();

    var order = Store.getTabOrder("setting", SET_ORDER);
    var active = Store.getLastTab("setting");
    if (SET_ORDER.indexOf(active) < 0) active = order[0];
    rebuildSetTabs(order, active);
    UI.setActiveTab(el("set-tabs"), active);

    // モーダル配線
    ["edit-modal", "search-modal", "exam-modal", "wordlist-modal", "preview-modal", "syntax-modal"].forEach(function (id) { UI.wireModal(el(id)); });

    wireMain();
    wireConn();
    wireList();
    wireRegister();
    wireIngest();
    wireCorpusSettings();

    // 接続済みなら設定読み込み
    el("cfg-worker").value = Store.getWorkerUrl();
    el("cfg-anthropic").value = Store.getAnthropicKey();
    if (Store.getWorkerUrl()) loadServerConfig();
    onTab(active);
  }

  // 設定ページのタブはアイコンのみ表示（名前はツールチップ）
  function rebuildSetTabs(order, active) {
    UI.buildTabs({
      tabsEl: el("set-tabs"), order: order, defs: SET_TABS, active: active,
      page: "setting", iconOnly: true,
      onChange: function (id) { Store.setLastTab("setting", id); onTab(id); }
    });
  }

  function onTab(id) {
    if (id === "list") loadList();
    if (id === "register") renderReg();
    if (id === "corpus") loadWordLists();
  }

  /* ================= タブ1: メイン設定 ================= */
  function wireMain() {
    el("cfg-title").value = Store.getSiteTitle();
    el("cfg-title-save").addEventListener("click", function () {
      var t = el("cfg-title").value.trim() || "入試問題データベース";
      Store.setSiteTitle(t);
      el("site-title").textContent = t;
      // Worker にも保存（全端末共有）
      if (Store.getWorkerUrl()) {
        Api.updateConfig({ site_title: t }).then(function () { toast("タイトルを保存しました", "ok"); })
          .catch(function () { toast("ローカルに保存しました（Worker未接続）", "ok"); });
      } else toast("ローカルに保存しました", "ok");
    });

    // サブタイトル
    el("cfg-subtitle").value = Store.getSiteSubtitle();
    el("cfg-subtitle-save").addEventListener("click", function () {
      var t = el("cfg-subtitle").value.trim();
      Store.setSiteSubtitle(t);
      el("site-subtitle").textContent = t || "Entrance Exam Database";
      if (Store.getWorkerUrl()) {
        Api.updateConfig({ site_subtitle: t }).then(function () { toast("サブタイトルを保存しました", "ok"); })
          .catch(function () { toast("ローカルに保存しました（Worker未接続）", "ok"); });
      } else toast("ローカルに保存しました", "ok");
    });
    renderOrderList("main", MAIN_TABS, MAIN_ORDER, el("order-main"));
    renderOrderList("setting", SET_TABS, SET_ORDER, el("order-setting"));

    // 独自ドメイン
    var dom = Store.getCustomDomain();
    el("cfg-domain").value = dom;
    updateDomainCurrent();
    el("cfg-domain-save").addEventListener("click", function () {
      Store.setCustomDomain(el("cfg-domain").value);
      UI.applyDomainLinks();
      updateDomainCurrent();
      if (Store.getWorkerUrl()) {
        Api.updateConfig({ custom_domain: Store.getCustomDomain() })
          .then(function () { toast("独自ドメインを保存しました", "ok"); })
          .catch(function () { toast("ローカルに保存しました（Worker未接続）", "ok"); });
      } else toast("ローカルに保存しました", "ok");
    });
  }

  function updateDomainCurrent() {
    var base = Store.getBaseUrl();
    el("domain-current").innerHTML = base
      ? '<i class="fa-solid fa-link"></i> リンク先: <code>' + esc(base) + "/</code> ・ <code>" + esc(base) + "/setting/</code>"
      : '<i class="fa-solid fa-link-slash"></i> 未設定（相対パスでリンク）。現在アクセス中: <code>' + esc(location.hostname) + "</code>";
  }

  function renderOrderList(page, defs, defOrder, container) {
    var order = Store.getTabOrder(page, defOrder);
    container.innerHTML = "";
    order.forEach(function (id, i) {
      var def = defs[id]; if (!def) return;
      var label = Store.getTabLabel(page, id, def.label);
      var li = create("li", { class: "sort-item" },
        '<i class="fa-solid ' + def.icon + '" style="color:var(--blue)"></i>' +
        '<input type="text" class="label" data-rename="' + esc(id) + '" value="' + esc(label) +
          '" placeholder="' + esc(def.label) + '" style="border:0;background:transparent;padding:4px 6px;font-size:14px" />' +
        '<span class="move">' +
        '<button class="icon-btn sm" data-up="' + i + '" title="上へ"' + (i === 0 ? " disabled" : "") + '><i class="fa-solid fa-arrow-up"></i></button>' +
        '<button class="icon-btn sm" data-down="' + i + '" title="下へ"' + (i === order.length - 1 ? " disabled" : "") + '><i class="fa-solid fa-arrow-down"></i></button>' +
        "</span>");
      container.appendChild(li);
    });
    $all("[data-up]", container).forEach(function (b) {
      b.addEventListener("click", function () { moveOrder(page, defOrder, Number(b.getAttribute("data-up")), -1, defs, container); });
    });
    $all("[data-down]", container).forEach(function (b) {
      b.addEventListener("click", function () { moveOrder(page, defOrder, Number(b.getAttribute("data-down")), 1, defs, container); });
    });
    // タブ名の変更（input/change 両対応でクロスブラウザに）
    $all("[data-rename]", container).forEach(function (inp) {
      var save = function () {
        var id = inp.getAttribute("data-rename");
        Store.setTabLabel(page, id, inp.value);
        if (page === "setting") rebuildSetTabs(Store.getTabOrder(page, defOrder), Store.getLastTab("setting") || defOrder[0]);
      };
      inp.addEventListener("change", save);
      inp.addEventListener("blur", save);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    });
  }
  function moveOrder(page, defOrder, idx, delta, defs, container) {
    var order = Store.getTabOrder(page, defOrder);
    var j = idx + delta;
    if (j < 0 || j >= order.length) return;
    var tmp = order[idx]; order[idx] = order[j]; order[j] = tmp;
    Store.setTabOrder(page, order);
    renderOrderList(page, defs, defOrder, container);
    // 設定ページ自身のタブは即時反映
    if (page === "setting") rebuildSetTabs(order, Store.getLastTab("setting") || order[0]);
    toast("並び順を更新しました", "ok");
  }

  /* ================= タブ2: 接続設定 ================= */
  function wireConn() {
    el("cfg-worker-save").addEventListener("click", function () {
      Store.setWorkerUrl(el("cfg-worker").value);
      toast("Worker URL を保存しました", "ok");
      loadServerConfig();
    });
    el("cfg-worker-test").addEventListener("click", function () {
      Store.setWorkerUrl(el("cfg-worker").value);
      el("conn-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> 接続中…';
      Api.testConnection().then(function (d) {
        el("conn-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> 接続成功（大学 ' + (d.universities || []).length + " 件）</span>";
        toast("接続に成功しました", "ok");
        loadServerConfig();
      }).catch(function (e) {
        el("conn-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
        toast("接続に失敗しました", "err");
      });
    });
    el("cfg-anthropic-save").addEventListener("click", function () {
      Store.setAnthropicKey(el("cfg-anthropic").value);
      el("anthropic-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> 保存しました</span>';
      toast("Anthropic API キーを保存しました", "ok");
    });
    el("cfg-anthropic-test").addEventListener("click", function () {
      var key = el("cfg-anthropic").value;
      Store.setAnthropicKey(key);
      el("anthropic-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> 確認中…';
      Api.testAnthropic(key).then(function () {
        el("anthropic-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> キーは有効です</span>';
        toast("Anthropic API キーは有効です", "ok");
      }).catch(function (e) {
        el("anthropic-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
        toast("接続テストに失敗しました", "err");
      });
    });
  }

  /* ================= タブ: PDF取り込み（自動解析） ================= */
  function wireIngest() {
    var run = el("ing-run");
    if (run) run.addEventListener("click", runIngest);
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { reject(new Error("ファイルの読み込みに失敗しました")); };
      r.readAsDataURL(file);
    });
  }

  var ING_PHASE_LABEL = {
    reading:   "PDFを読み込み中…",
    uploading: "PDFを送信中…",
    received:  "PDF受信完了 — AI解析の準備中…",
    analyzing: "AIが解析中…（大問・セクションに振り分け）",
    parsing:   "解析結果を整形中…"
  };
  function ingFmt(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  function runIngest() {
    var f = el("ing-file").files[0];
    if (!f) { toast("PDF ファイルを選択してください", "err"); return; }
    if (f.type && f.type.indexOf("pdf") < 0) { toast("PDF ファイルを選択してください", "err"); return; }
    if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
    var key = Store.getAnthropicKey();
    if (!key) { toast("Anthropic API キーが未設定です（接続設定タブ）", "err"); return; }

    var hint = {
      year: Number(el("ing-year").value) || undefined,
      universityName: el("ing-university").value.trim() || undefined,
      schedule: el("ing-schedule").value.trim() || undefined
    };
    el("ing-run").disabled = true;
    el("ing-result").innerHTML = "";

    var t0 = Date.now();
    var phase = "reading";
    var detail = "";
    var finished = false;
    var timer = setInterval(renderStatus, 1000);
    function renderStatus() {
      var label = ING_PHASE_LABEL[phase] || "処理中…";
      el("ing-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> ' +
        esc(label) + (detail ? " " + esc(detail) : "") + ' <span class="hint">（経過 ' + ingFmt(Date.now() - t0) + "）</span>";
    }
    function setPhase(p) { phase = p; renderStatus(); }
    function finishOk(data) {
      if (finished) return; finished = true;
      clearInterval(timer);
      el("ing-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> 解析完了（' + ingFmt(Date.now() - t0) + "）</span>";
      el("ing-run").disabled = false;
      renderIngestResult(data || {});
    }
    function finishErr(e) {
      if (finished) return; finished = true;
      clearInterval(timer);
      el("ing-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message || "解析に失敗しました") + "</span>";
      el("ing-run").disabled = false;
      toast(e.message || "解析に失敗しました", "err");
    }

    renderStatus();
    fileToBase64(f).then(function (b64) {
      setPhase("uploading");
      return Api.ingestPdfStream({ pdfBase64: b64, hint: hint }, key, function (ev) {
        if (!ev || !ev.phase) return;
        if (ev.phase === "done") { finishOk(ev.result); return; }
        if (ev.phase === "error") { finishErr(new Error(ev.message)); return; }
        if (ev.phase === "received") { detail = ""; setPhase("received"); }
        else if (ev.phase === "analyzing") { detail = ev.chars ? "（受信 " + ev.chars + " 文字）" : ""; setPhase("analyzing"); }
        else if (ev.phase === "parsing") { detail = ""; setPhase("parsing"); }
      });
    }).then(function () {
      // ストリームが done/error イベント無しで終了した場合
      if (!finished) finishErr(new Error("解析が途中で終了しました。もう一度お試しください。"));
    }).catch(function (e) {
      finishErr(e);
    });
  }

  function ingMetaInput(id, label, val, type) {
    return '<div class="reg-meta-item"><span class="field-label">' + esc(label) + '</span>' +
      '<input type="' + (type || "text") + '" id="' + id + '" value="' + esc(String(val)) + '"></div>';
  }
  function ingSectionTa(label, cls, val) {
    return '<div style="margin-top:10px"><span class="field-label">' + esc(label) + "</span>" +
      '<textarea class="' + cls + '" rows="6" style="width:100%">' + esc(val || "") + "</textarea></div>";
  }

  function renderIngestResult(data) {
    var qs = (data && Array.isArray(data.questions)) ? data.questions : [];
    var h = "";
    if (data && data._truncated) {
      h += '<div class="card"><p class="hint" style="color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i> 出力が長く途中で切れた可能性があります。大問数が多い場合は PDF を分割して取り込んでください。</p></div>';
    }
    h += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-circle-check ic"></i> 解析結果（確認・修正して登録）</h3></div>';
    h += '<div class="reg-meta">';
    h += ingMetaInput("ing-r-university", "大学名", (data && data.universityName) || "");
    h += ingMetaInput("ing-r-year", "年度", (data && data.year) || "", "number");
    h += ingMetaInput("ing-r-schedule", "方式", (data && data.schedule) || "");
    h += "</div></div>";

    qs.forEach(function (q, i) {
      h += '<div class="card" data-qcard="' + i + '">';
      h += '<div class="card-head"><h3 style="font-size:14px"><i class="fa-solid fa-hashtag ic"></i> 大問 ' +
        '<input type="number" min="1" class="ing-q-num" style="width:64px" value="' + (Number(q.questionNumber) || (i + 1)) + '"></h3>' +
        '<span class="spacer"></span>' +
        '<input type="text" class="ing-q-cat" placeholder="種別（任意）" value="' + esc(q.category || "") + '" style="width:170px"></div>';
      h += ingSectionTa("問題", "ing-q-problem", q.problemText);
      h += ingSectionTa("解答", "ing-q-answer", q.answerText);
      h += ingSectionTa("解説", "ing-q-comment", q.commentaryText);
      h += "</div>";
    });

    h += '<div class="toolbar" style="margin-top:8px;justify-content:flex-end">' +
      '<button class="btn primary" id="ing-register"><i class="fa-solid fa-floppy-disk"></i> この内容で登録（全' + qs.length + "大問）</button></div>";
    el("ing-result").innerHTML = h;
    if (el("ing-register")) el("ing-register").addEventListener("click", registerIngest);
  }

  function registerIngest() {
    var uni = el("ing-r-university").value.trim();
    var year = Number(el("ing-r-year").value);
    var sched = el("ing-r-schedule").value.trim();
    if (!uni || !year || !sched) { toast("大学名・年度・方式を入力してください", "err"); return; }

    var cards = $all("[data-qcard]", el("ing-result"));
    var questions = cards.map(function (card) {
      return {
        questionNumber: Number($(".ing-q-num", card).value) || 1,
        category: $(".ing-q-cat", card).value.trim(),
        problemText: $(".ing-q-problem", card).value,
        answerText: $(".ing-q-answer", card).value,
        commentaryText: $(".ing-q-comment", card).value
      };
    });
    if (!questions.length) { toast("登録する大問がありません", "err"); return; }

    el("ing-register").disabled = true;
    Api.createExam({ universityName: uni, year: year, schedule: sched, questions: questions }).then(function () {
      toast("登録しました（" + questions.length + " 大問）", "ok");
      el("ing-register").disabled = false;
      loadServerConfig();
    }).catch(function (e) {
      toast(e.message, "err");
      el("ing-register").disabled = false;
    });
  }

  function loadServerConfig() {
    return Promise.all([
      Api.getConfig().catch(function () { return { schedules: [], year_presets: [], question_categories: [], section_types: [] }; }),
      Api.getUniversities().catch(function () { return { universities: [] }; })
    ]).then(function (res) {
      state.config = res[0] || { schedules: [], year_presets: [], question_categories: [], section_types: [] };
      if (!Array.isArray(state.config.schedules)) state.config.schedules = [];
      if (!Array.isArray(state.config.year_presets)) state.config.year_presets = [];
      if (!Array.isArray(state.config.question_categories)) state.config.question_categories = [];
      if (!Array.isArray(state.config.section_types)) state.config.section_types = ["問題", "解答", "解説"];
      Store.setSectionTypes(state.config.section_types);
      state.universities = (res[1] && res[1].universities) || [];
      // サブタイトル（Worker 側にあれば反映）
      if (state.config.site_subtitle) {
        Store.setSiteSubtitle(state.config.site_subtitle);
        el("site-subtitle").textContent = state.config.site_subtitle;
        el("cfg-subtitle").value = state.config.site_subtitle;
      }
      // 独自ドメイン（Worker 側にあればローカル未設定時に取り込む）
      if (state.config.custom_domain && !Store.getCustomDomain()) {
        Store.setCustomDomain(state.config.custom_domain);
        el("cfg-domain").value = Store.getCustomDomain();
        UI.applyDomainLinks();
        updateDomainCurrent();
      }
      // 検索モーダルの選択肢
      fillSelect(el("sm-year"), state.config.year_presets, "指定なし");
      fillSelect(el("sm-schedule"), state.config.schedules, "指定なし");
      fillSelect(el("sm-university"), state.universities.map(function (u) { return u.name; }), "指定なし");
      fillSelect(el("sm-category"), state.config.question_categories || [], "指定なし");
      // 登録フォーム
      fillRegSelects();
    });
  }

  function fillSelect(sel, items, placeholder) {
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(placeholder) + "</option>";
    (items || []).forEach(function (it) { var o = create("option"); o.value = it; o.textContent = it; sel.appendChild(o); });
    sel.value = cur;
  }

  /* ================= タブ3: 入試問題一覧 ================= */
  function findListNavIndex() {
    var nav = state.list.nav, rows = state.list.sortedRows;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].exam_id === nav.examId && rows[i].question_number === nav.qnum) return i;
    }
    return -1;
  }
  function updateListExamNav() {
    var idx = findListNavIndex(), total = state.list.sortedRows.length;
    el("exam-prev").disabled = (idx <= 0);
    el("exam-next").disabled = (idx < 0 || idx >= total - 1);
    el("exam-nav-label").textContent = (idx >= 0 && total > 0) ? (idx + 1) + " / " + total : "";
    el("exam-show-all").style.display = (state.list.nav.qnum != null) ? "" : "none";
  }
  function wireList() {
    el("list-search").addEventListener("click", function () { openSearchModal(runListSearch); });
    el("list-clear").addEventListener("click", function () {
      state.list.filter = { word: "", universityName: "", year: "", schedule: "", qnum: "", category: "" };
      loadList();
    });
    el("exam-prev").addEventListener("click", function () {
      var idx = findListNavIndex(), rows = state.list.sortedRows;
      if (idx > 0) { var r = rows[idx - 1]; openExam(r.exam_id, r.question_number); }
    });
    el("exam-next").addEventListener("click", function () {
      var idx = findListNavIndex(), rows = state.list.sortedRows;
      if (idx >= 0 && idx < rows.length - 1) { var r = rows[idx + 1]; openExam(r.exam_id, r.question_number); }
    });
    el("exam-show-all").addEventListener("click", function () {
      if (state.list.nav.examId != null) openExam(state.list.nav.examId, null);
    });
  }
  function runListSearch() {
    state.list.filter = readSearchModal();
    UI.closeModal(el("search-modal"));
    loadList();
  }
  function loadList() {
    if (!Store.getWorkerUrl()) { el("list-area").innerHTML = noWorker(); return; }
    var f = state.list.filter;
    var parts = [];
    if (f.word) parts.push("「" + f.word + "」");
    if (f.year) parts.push(f.year + "年"); if (f.universityName) parts.push(f.universityName);
    if (f.schedule) parts.push(f.schedule); if (f.qnum) parts.push("大問" + f.qnum);
    if (f.category) parts.push(f.category);
    el("list-summary").textContent = parts.length ? parts.join(" / ") : "すべての入試問題";
    el("list-area").innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> 読み込み中…</div></div>';
    Api.search({ word: f.word, universityName: f.universityName, year: f.year, schedule: f.schedule, category: f.category }).then(function (data) {
      var rows = (data.results || []).map(function (r) {
        return {
          exam_id: r.exam_id, question_id: r.question_id,
          question_number: r.question_number, category: r.category || "",
          university_name: r.university_name, year: r.year, schedule: r.schedule
        };
      });
      if (f.qnum) {
        var qn = Number(f.qnum);
        rows = rows.filter(function (r) { return r.question_number === qn; });
      }
      state.list.rows = rows;
      renderListTable();
    }).catch(function (e) {
      el("list-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div></div>";
    });
  }
  function renderListTable() {
    var rows = state.list.rows.slice();
    var key = state.list.sort.key, dir = state.list.sort.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === "year" || key === "question_number") { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av || "").toLowerCase(); bv = String(bv || "").toLowerCase(); }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    if (!rows.length) { el("list-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>該当する入試問題がありません。</div></div>'; return; }
    var cols = [
      { key: "year", label: "年度" },
      { key: "university_name", label: "大学名" },
      { key: "schedule", label: "方式" },
      { key: "question_number", label: "大問" },
      { key: "category", label: "種別" }
    ];
    var html = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) {
      var sorted = state.list.sort.key === c.key;
      var ic = sorted ? (state.list.sort.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort";
      html += '<th class="sortable' + (sorted ? " sorted" : "") + '" data-sort="' + c.key + '">' + esc(c.label) + '<i class="fa-solid ' + ic + ' sort-ic"></i></th>';
    });
    html += '<th style="text-align:right">操作</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += "<tr>" +
        "<td><span class=\"pill em\">" + esc(r.year) + "</span></td>" +
        "<td><strong>" + esc(r.university_name) + "</strong></td>" +
        "<td>" + esc(r.schedule) + "</td>" +
        "<td>大問" + esc(r.question_number) + "</td>" +
        "<td>" + esc(r.category) + "</td>" +
        "<td class=\"row-actions\">" +
        "<button class=\"icon-btn\" data-view=\"" + r.exam_id + ":" + r.question_number + "\" title=\"表示\"><i class=\"fa-solid fa-file-lines\"></i></button>" +
        "<button class=\"icon-btn\" data-edit=\"" + r.exam_id + ":" + r.question_number + "\" title=\"編集\"><i class=\"fa-solid fa-pen\"></i></button>" +
        "<button class=\"icon-btn danger\" data-del=\"" + r.exam_id + ":" + r.question_number + "\" title=\"削除\"><i class=\"fa-solid fa-trash\"></i></button>" +
        "</td></tr>";
    });
    html += "</tbody></table></div>";
    state.list.sortedRows = rows;
    el("list-area").innerHTML = html;
    $all("th.sortable", el("list-area")).forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-sort");
        if (state.list.sort.key === k) state.list.sort.dir = state.list.sort.dir === "asc" ? "desc" : "asc";
        else { state.list.sort.key = k; state.list.sort.dir = (k === "year" || k === "question_number") ? "desc" : "asc"; }
        renderListTable();
      });
    });
    $all("[data-view]", el("list-area")).forEach(function (b) {
      b.addEventListener("click", function () {
        var val = b.getAttribute("data-view");
        var parts = val.split(":");
        openExam(Number(parts[0]), parts[1] ? Number(parts[1]) : null);
      });
    });
    $all("[data-edit]", el("list-area")).forEach(function (b) {
      b.addEventListener("click", function () {
        var val = b.getAttribute("data-edit");
        var parts = val.split(":");
        var examId = Number(parts[0]);
        var qnum = parts[1] ? Number(parts[1]) : undefined;
        loadExamIntoForm(examId, qnum);
      });
    });
    $all("[data-del]", el("list-area")).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("この大問を削除しますか？")) return;
        var val = b.getAttribute("data-del");
        var parts = val.split(":");
        var examId = Number(parts[0]);
        var qnum = parts[1] ? Number(parts[1]) : null;
        var p = qnum ? Api.deleteQuestion(examId, qnum) : Api.deleteExam(examId);
        p.then(function () { toast("削除しました", "ok"); loadList(); })
          .catch(function (e) { toast(e.message, "err"); });
      });
    });
  }

  /* 検索モーダル共通 */
  var searchCb = null;
  function openSearchModal(cb) {
    searchCb = cb;
    var f = state.list.filter;
    el("sm-word").value = f.word; el("sm-year").value = f.year; el("sm-university").value = f.universityName;
    el("sm-schedule").value = f.schedule; el("sm-qnum").value = f.qnum; el("sm-category").value = f.category || "";
    UI.openModal(el("search-modal"));
  }
  function readSearchModal() {
    return { word: el("sm-word").value.trim(), universityName: el("sm-university").value, year: el("sm-year").value, schedule: el("sm-schedule").value, qnum: el("sm-qnum").value.trim(), category: el("sm-category").value };
  }
  function wireSearchModalTabs() {
    $all("#search-modal-tabs .tab").forEach(function (t) {
      t.addEventListener("click", function () {
        var id = t.getAttribute("data-mtab");
        $all("#search-modal-tabs .tab").forEach(function (x) { x.classList.toggle("active", x === t); });
        $all("[data-mpanel]", el("search-modal")).forEach(function (p) { p.style.display = p.getAttribute("data-mpanel") === id ? "" : "none"; });
      });
    });
    el("sm-run").addEventListener("click", function () { if (searchCb) searchCb(); });
  }

  /* 入試問題表示モーダル */
  function openExam(examId, qnum) {
    state.list.nav = { examId: examId, qnum: qnum };
    updateListExamNav();
    UI.openModal(el("exam-modal"));
    el("exam-modal-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      var title = ex.year + "年 " + ex.university_name + " " + ex.schedule;
      var questions = ex.questions || [];
      if (qnum != null) {
        title += " 大問" + qnum;
        questions = questions.filter(function (q) { return q.question_number === qnum; });
      }
      el("exam-modal-title").textContent = title;
      var body = "";
      questions.forEach(function (q) {
        var fields = [];
        var sections = Markup.parseSections(q.problem_text || "");
        var hasAnswer = sections.some(function (s) { return s.type === "解答"; });
        var hasCommentary = sections.some(function (s) { return s.type === "解説"; });
        sections.forEach(function (sec) {
          if (sec.text.trim()) fields.push(field(sec.type, SECTION_ICONS[sec.type] || "fa-circle-question", sec.text));
        });
        if (q.answer_text && q.answer_text.trim() && !hasAnswer) fields.push(field("解答", "fa-circle-check", q.answer_text));
        if (q.commentary_text && q.commentary_text.trim() && !hasCommentary) fields.push(field("解説", "fa-comment-dots", q.commentary_text));
        body += '<div class="exam-section">' + fields.join('<hr class="exam-hr exam-field-sep">') + "</div>";
      });
      el("exam-modal-body").innerHTML = body || '<div class="empty">大問が登録されていません。</div>';
    }).catch(function (e) { el("exam-modal-body").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
  }
  function field(label, icon, text) {
    return '<div style="margin-bottom:14px"><div class="exam-section-title">' + esc(label) +
      '</div><div class="exam-doc">' + Markup.render(text).html + "</div></div>";
  }

  /* ================= タブ4: 問題登録 ================= */
  var SECTION_ICONS = { "問題": "fa-circle-question", "解答": "fa-circle-check", "解説": "fa-comment-dots" };

  /* ---- プレビューモーダルの文字サイズ・印刷（viewer.js と同じ5段階） ---- */
  var PV_FS_ORDER = ["xs", "sm", "md", "lg", "xl"];
  var PV_FS_LABEL = { xs: "極小", sm: "小", md: "中", lg: "大", xl: "極大" };
  function applyPreviewFontSize(size) {
    var body = el("preview-body");
    PV_FS_ORDER.forEach(function (s) { body.classList.remove("fs-" + s); });
    body.classList.add("fs-" + size);
    el("preview-fontsize").title = "文字サイズ変更（現在: " + PV_FS_LABEL[size] + "）";
  }
  function printPreview() {
    var area = el("print-area");
    area.className = "fs-" + Store.getFontSize();
    var clone = el("preview-body").cloneNode(true);
    $all(".print-check", clone).forEach(function (n) { n.parentNode.removeChild(n); });
    area.innerHTML = '<h1 class="print-title">' + esc(el("preview-modal-title").textContent) + "</h1>" + clone.innerHTML;
    window.print();
  }
  function openPreview(title, bodyHtml) {
    el("preview-modal-title").textContent = title;
    el("preview-body").innerHTML = bodyHtml;
    applyPreviewFontSize(Store.getFontSize());
    UI.openModal(el("preview-modal"));
  }

  function wireRegister() {
    el("reg-add-section").addEventListener("click", function () { addSection(); renderReg(); saveDraft(); });
    el("reg-reset").addEventListener("click", resetReg);
    el("reg-new").addEventListener("click", resetReg);
    el("reg-save").addEventListener("click", saveReg);
    el("reg-preview").addEventListener("click", previewReg);
    el("preview-fontsize").addEventListener("click", function () {
      var next = PV_FS_ORDER[(PV_FS_ORDER.indexOf(Store.getFontSize()) + 1) % PV_FS_ORDER.length];
      Store.setFontSize(next);
      applyPreviewFontSize(next);
      toast("文字サイズ: " + PV_FS_LABEL[next], "ok");
    });
    el("preview-print").addEventListener("click", printPreview);
    el("reg-year-edit").addEventListener("click", function () { openYearEdit(); });
    el("reg-sched-edit").addEventListener("click", function () { openScheduleEdit(); });
    el("reg-uni-edit").addEventListener("click", function () { openUniversityEdit(); });
    el("reg-cat-edit").addEventListener("click", function () { openCategoryEdit(); });
    el("reg-types-edit").addEventListener("click", function () { openTypesEdit(); });
    // メタ情報の変更を下書きへ反映
    ["reg-year", "reg-university", "reg-schedule", "reg-qnum", "reg-category"].forEach(function (id) {
      el(id).addEventListener("change", syncMeta);
      el(id).addEventListener("input", syncMeta);
    });
    // 下書き（前回の編集内容）を復元
    restoreDraft();
    if (!state.reg.sections.length) addSection("問題");
  }
  function addSection(type) {
    var types = (state.config.section_types && state.config.section_types.length) ? state.config.section_types : Store.getSectionTypes();
    state.reg.sections.push({ type: type || types[0], text: "" });
  }
  function fillRegSelects() {
    fillSelect(el("reg-year"), state.config.year_presets, "—");
    fillSelect(el("reg-schedule"), state.config.schedules, "—");
    fillSelect(el("reg-university"), state.universities.map(function (u) { return u.name; }), "—");
    fillSelect(el("reg-category"), state.config.question_categories || [], "—");
    applyMetaToDom();
  }

  /* ---- 問題登録フォームのメタ情報 + 下書き保存 ---- */
  function defaultMeta() { return { year: "", university: "", schedule: "", qnum: "1", category: "" }; }
  function readMetaFromDom() {
    return {
      year: el("reg-year").value, university: el("reg-university").value,
      schedule: el("reg-schedule").value, qnum: el("reg-qnum").value, category: el("reg-category").value
    };
  }
  function applyMetaToDom() {
    var m = state.reg.meta || defaultMeta();
    el("reg-year").value = m.year || "";
    el("reg-university").value = m.university || "";
    el("reg-schedule").value = m.schedule || "";
    el("reg-qnum").value = m.qnum || "1";
    el("reg-category").value = m.category || "";
  }
  function syncMeta() { state.reg.meta = readMetaFromDom(); saveDraft(); }
  function saveDraft() {
    Store.setRegDraft({ editingExamId: state.reg.editingExamId, sections: state.reg.sections, meta: state.reg.meta });
  }
  function restoreDraft() {
    var d = Store.getRegDraft();
    if (!d) { state.reg.meta = defaultMeta(); return; }
    state.reg.editingExamId = d.editingExamId || null;
    state.reg.sections = (Array.isArray(d.sections) && d.sections.length) ? d.sections : [];
    state.reg.meta = d.meta || defaultMeta();
  }
  function renderReg() {
    fillRegSelects();
    el("reg-mode-label").textContent = state.reg.editingExamId ? "問題を編集" : "新規 問題登録";
    var types = (state.config.section_types && state.config.section_types.length) ? state.config.section_types : Store.getSectionTypes();
    var c = el("reg-sections");
    c.innerHTML = "";
    state.reg.sections.forEach(function (sec, i) {
      var box = create("div", { class: "reg-section" });
      var typeOpts = types.map(function (t) { return '<option value="' + esc(t) + '"' + (t === sec.type ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
      box.innerHTML =
        '<div class="reg-section-head">' +
          '<span class="idx">' + (i + 1) + "</span>" +
          '<select data-sectype="' + i + '" style="max-width:160px">' + typeOpts + "</select>" +
          '<span class="spacer"></span>' +
          '<button class="icon-btn sm" data-secup="' + i + '" title="上へ"' + (i === 0 ? " disabled" : "") + '><i class="fa-solid fa-arrow-up"></i></button>' +
          '<button class="icon-btn sm" data-secdown="' + i + '" title="下へ"' + (i === state.reg.sections.length - 1 ? " disabled" : "") + '><i class="fa-solid fa-arrow-down"></i></button>' +
          '<button class="icon-btn sm" data-secpv="' + i + '" title="見え方を確認"><i class="fa-solid fa-file-lines"></i></button>' +
          '<button class="icon-btn sm danger" data-secdel="' + i + '" title="削除"><i class="fa-solid fa-trash"></i></button>' +
        "</div>" +
        markupBar(i) +
        '<textarea data-sectext="' + i + '" rows="6" placeholder="入試問題記法で入力…">' + esc(sec.text) + "</textarea>";
      c.appendChild(box);
    });
    wireRegSection();
  }
  // 記法ボタン定義（ラベルは最小限の表記）
  var MK_DEFS = [
    { l: "問",   t: "問見出し {{問1}}",        b: "{{問", a: "}}" },
    { l: "空所", t: "空所 [[1]]",              b: "[[", a: "]]" },
    { l: "選択", t: "選択肢 ((A)) 本文",        b: "((", a: "))" },
    { l: "蛍光", t: "ハイライト ==語==",        b: "==", a: "==" },
    { l: "色",   t: "色付きハイライト ==語==:色", b: "==", a: "==:yellow" },
    { l: "下線", t: "下線 __語__",              b: "__", a: "__" },
    { l: "太字", t: "太字 **語**",              b: "**", a: "**" },
    { l: "語注", t: "語注 ##語::訳##",          b: "##", a: "::訳##" },
    { l: "下付", t: "下付き ~~x~~",             b: "~~", a: "~~" },
    { l: "上付", t: "上付き ^^x^^",             b: "^^", a: "^^" },
    { l: "詰め", t: "字下げなし @@ （段落先頭のインデント抑制）", b: "@@", a: "" },
    { l: "区切", t: "区切り線 ----",            b: "\n----\n", a: "" }
  ];
  function markupBar(i) {
    var h = '<div class="markup-bar">';
    MK_DEFS.forEach(function (bn, k) {
      h += '<button class="btn sm" data-mk="' + i + ":" + k + '" title="' + esc(bn.t) + '">' + esc(bn.l) + "</button>";
    });
    h += '<button class="btn sm link" data-syntax="1" title="記法の一覧と見え方"><i class="fa-solid fa-circle-question"></i> 記法一覧</button>';
    h += "</div>";
    return h;
  }
  function wireRegSection() {
    var c = el("reg-sections");
    $all("[data-sectype]", c).forEach(function (s) { s.addEventListener("change", function () { state.reg.sections[Number(s.getAttribute("data-sectype"))].type = s.value; saveDraft(); }); });
    $all("[data-sectext]", c).forEach(function (t) { t.addEventListener("input", function () { state.reg.sections[Number(t.getAttribute("data-sectext"))].text = t.value; saveDraft(); }); });
    $all("[data-secup]", c).forEach(function (b) { b.addEventListener("click", function () { moveSection(Number(b.getAttribute("data-secup")), -1); }); });
    $all("[data-secdown]", c).forEach(function (b) { b.addEventListener("click", function () { moveSection(Number(b.getAttribute("data-secdown")), 1); }); });
    $all("[data-secdel]", c).forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-secdel"));
        state.reg.sections.splice(i, 1);
        if (!state.reg.sections.length) addSection("問題");
        renderReg();
        saveDraft();
      });
    });
    $all("[data-mk]", c).forEach(function (b) {
      b.addEventListener("click", function () {
        var parts = b.getAttribute("data-mk").split(":");
        var i = Number(parts[0]), k = Number(parts[1]);
        var ta = $('[data-sectext="' + i + '"]', c);
        insertMarkup(ta, MK_DEFS[k].b, MK_DEFS[k].a);
        state.reg.sections[i].text = ta.value;
        saveDraft();
      });
    });
    $all("[data-syntax]", c).forEach(function (b) { b.addEventListener("click", openSyntaxModal); });
    // セクション単位の見え方確認
    $all("[data-secpv]", c).forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-secpv"));
        var sec = state.reg.sections[i];
        openPreview(sec.type, field(sec.type, SECTION_ICONS[sec.type] || "fa-file-lines", sec.text || "（未入力）"));
      });
    });
  }

  /* ---- 記法一覧モーダル（記法と見え方を並べて表示） ---- */
  var SYNTAX_EXAMPLES = [
    { code: "{{問1}} 次の文を読みなさい。", desc: "大問見出し（行頭）" },
    { code: "Fill in [[1]] and [[A]].", desc: "空所バッジ" },
    { code: "The ##immune::免疫## system.", desc: "語注（末尾に訳一覧）" },
    { code: "This is ==important==.", desc: "ハイライト（黄）" },
    { code: "A ==keyword==:blue here.", desc: "色付きハイライト（yellow/blue/red/purple/pink/green/aqua）" },
    { code: "An __underlined__ word.", desc: "下線" },
    { code: "A **bold** word.", desc: "太字" },
    { code: "H~~2~~O and 1^^st^^.", desc: "下付き・上付き" },
    { code: "((A)) apple\n((B)) a very long choice that wraps neatly onto the next line", desc: "選択肢（行頭。折り返しも整形）" },
    { code: "----", desc: "区切り線" },
    { code: "@@The quick brown fox jumps.", desc: "@@ — 行頭に付けると段落インデントを抑制" }
  ];
  function openSyntaxModal() {
    var h = "";
    SYNTAX_EXAMPLES.forEach(function (ex) {
      h += '<div style="margin-bottom:16px">' +
        '<div class="exam-section-title">' + esc(ex.desc) + "</div>" +
        '<pre style="margin:0 0 6px;background:var(--grad-chip);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:12.5px;white-space:pre-wrap;overflow-x:auto">' + esc(ex.code) + "</pre>" +
        '<div class="exam-doc" style="border:1px dashed var(--line);border-radius:8px;padding:8px 12px">' + Markup.render(ex.code).html + "</div>" +
      "</div>";
    });
    el("syntax-body").innerHTML = h;
    UI.openModal(el("syntax-modal"));
  }
  function moveSection(i, delta) {
    var j = i + delta; if (j < 0 || j >= state.reg.sections.length) return;
    var tmp = state.reg.sections[i]; state.reg.sections[i] = state.reg.sections[j]; state.reg.sections[j] = tmp;
    renderReg();
    saveDraft();
  }
  // テキストエリアにマークアップ挿入。選択範囲を before/after で囲む。
  // 選択なしの場合は before|after の中央にカーソルを置く（例: 空所 [[ | ]]）。
  function insertMarkup(ta, before, after) {
    ta.focus();
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var sel = v.slice(s, e);
    ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
    var caret = sel ? s + before.length + sel.length + after.length : s + before.length;
    ta.selectionStart = ta.selectionEnd = caret;
    ta.focus();
  }
  function collectReg() {
    var year = el("reg-year").value, uni = el("reg-university").value, sched = el("reg-schedule").value;
    var qnum = Number(el("reg-qnum").value) || 1;
    var category = el("reg-category").value || "";

    // problemText に全セクションを順序どおり統合（セクション区切り {{名}} 付き）
    var problemLines = [];
    state.reg.sections.forEach(function (sec) {
      var t = sec.text || "";
      if (sec.type !== "問題") problemLines.push("{{" + sec.type + "}}");
      if (t) problemLines.push(t);
    });
    var problemText = problemLines.join("\n\n");

    // 後方互換のため、解答・解説も別途抽出
    var answer = [], commentary = [];
    state.reg.sections.forEach(function (sec) {
      if (sec.type === "解答") answer.push(sec.text || "");
      else if (sec.type === "解説") commentary.push(sec.text || "");
    });

    return {
      universityName: uni, year: Number(year), schedule: sched,
      questions: [{
        questionNumber: qnum, category: category,
        problemText: problemText,
        answerText: answer.join("\n\n"),
        commentaryText: commentary.join("\n\n")
      }]
    };
  }
  function saveReg() {
    var data = collectReg();
    if (!data.year || !data.universityName || !data.schedule) { toast("年度・大学名・方式を選択してください", "err"); return; }
    var wasEditing = !!state.reg.editingExamId;
    var p = wasEditing ? Api.updateExam(state.reg.editingExamId, data) : Api.createExam(data);
    p.then(function (res) {
      // 方式・年度・大学を変更した結果、既存の同じ試験に統合された場合は統合先を読み込み直す
      if (res && res.merged && res.exam && res.exam.id) {
        toast("既存の同じ試験に統合しました", "ok");
        loadExamIntoForm(res.exam.id, undefined, true);
        saveDraft();
        loadServerConfig();
        return;
      }
      toast(wasEditing ? "更新しました" : "登録しました", "ok");
      // 編集画面はクリアしない（「新規作成」を押すまで保持）。
      // 新規登録時は以降の保存が二重登録にならないよう編集モードへ移行。
      if (res && res.exam && res.exam.id) {
        state.reg.editingExamId = res.exam.id;
        renderReg();
      }
      saveDraft();
      loadServerConfig();
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function resetReg() {
    state.reg.editingExamId = null;
    state.reg.sections = [];
    addSection("問題");
    state.reg.meta = defaultMeta();
    Store.clearRegDraft();
    renderReg();
  }
  function previewReg() {
    var data = collectReg();
    var m = state.reg.meta;
    var title = [m.year, m.university, m.schedule].filter(Boolean).join(" ") || "プレビュー";
    var q = data.questions[0];
    var fields = [];
    // problemText に全セクション（問題・解答・解説）が順序どおり含まれている
    Markup.parseSections(q.problemText || "").forEach(function (sec) {
      if (sec.text.trim()) fields.push(field(sec.type, SECTION_ICONS[sec.type] || "fa-circle-question", sec.text));
    });
    var body = '<div class="exam-section">' + fields.join('<hr class="exam-hr exam-field-sep">') + "</div>";
    openPreview(title, body);
  }
  function loadExamIntoForm(examId, questionNumber, silent) {
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      // 指定された大問番号を探す（未指定の場合は最初の大問）
      var q = null;
      if (questionNumber !== undefined) {
        q = (ex.questions || []).find(function (qu) { return qu.question_number === questionNumber; });
      }
      if (!q) q = (ex.questions || [])[0];
      if (!q) q = { question_number: 1, problem_text: "", answer_text: "", commentary_text: "" };

      state.reg.editingExamId = examId;
      state.reg.editingQuestionNumber = q.question_number;
      state.reg.sections = [];

      var sections = Markup.parseSections(q.problem_text);
      var hasAnswerSection = sections.some(function (s) { return s.type === "解答"; });
      var hasCommentarySection = sections.some(function (s) { return s.type === "解説"; });

      sections.forEach(function (sec) {
        state.reg.sections.push({ type: sec.type, text: sec.text });
      });

      // 既存互換：別カラムに解答・解説がある場合は追加
      if (q.answer_text && q.answer_text.trim() && !hasAnswerSection) {
        state.reg.sections.push({ type: "解答", text: q.answer_text });
      }
      if (q.commentary_text && q.commentary_text.trim() && !hasCommentarySection) {
        state.reg.sections.push({ type: "解説", text: q.commentary_text });
      }

      if (!state.reg.sections.length) addSection("問題");
      state.reg.meta = {
        year: String(ex.year), university: ex.university_name, schedule: ex.schedule,
        qnum: String(q.question_number || 1), category: q.category || ""
      };
      UI.setActiveTab(el("set-tabs"), "register"); Store.setLastTab("setting", "register");
      renderReg();
      saveDraft();
      if (!silent) toast("編集モードで読み込みました", "ok");
    }).catch(function (e) { toast(e.message, "err"); });
  }

  /* ---- 年度/方式/大学/種別 編集モーダル（汎用） ---- */
  function openEditModal(title, items, onSave) {
    state.editCtx = { items: items.slice(), onSave: onSave };
    el("edit-modal-title").textContent = title;
    el("edit-new").value = "";
    renderEditList();
    UI.openModal(el("edit-modal"));
  }
  function renderEditList() {
    var items = state.editCtx.items, c = el("edit-list");
    c.innerHTML = "";
    if (!items.length) c.innerHTML = '<li class="hint">項目がありません。上で追加してください。</li>';
    items.forEach(function (it, i) {
      var li = create("li", { class: "sort-item" },
        '<span class="label">' + esc(it) + "</span><span class='move'>" +
        '<button class="icon-btn sm" data-up="' + i + '"' + (i === 0 ? " disabled" : "") + '><i class="fa-solid fa-arrow-up"></i></button>' +
        '<button class="icon-btn sm" data-down="' + i + '"' + (i === items.length - 1 ? " disabled" : "") + '><i class="fa-solid fa-arrow-down"></i></button>' +
        '<button class="icon-btn sm danger" data-del="' + i + '"><i class="fa-solid fa-trash"></i></button></span>');
      c.appendChild(li);
    });
    $all("[data-up]", c).forEach(function (b) { b.addEventListener("click", function () { var i = +b.getAttribute("data-up"); swap(state.editCtx.items, i, i - 1); renderEditList(); }); });
    $all("[data-down]", c).forEach(function (b) { b.addEventListener("click", function () { var i = +b.getAttribute("data-down"); swap(state.editCtx.items, i, i + 1); renderEditList(); }); });
    $all("[data-del]", c).forEach(function (b) { b.addEventListener("click", function () { state.editCtx.items.splice(+b.getAttribute("data-del"), 1); renderEditList(); }); });
  }
  function swap(arr, i, j) { if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  function openYearEdit() { openEditModal("年度の編集", state.config.year_presets, function (items) {
    return Api.updateConfig({ year_presets: items }).then(function () { state.config.year_presets = items; fillRegSelects(); fillSelect(el("sm-year"), items, "指定なし"); });
  }); }
  function openScheduleEdit() { openEditModal("方式の編集", state.config.schedules, function (items) {
    return Api.updateConfig({ schedules: items }).then(function () { state.config.schedules = items; fillRegSelects(); fillSelect(el("sm-schedule"), items, "指定なし"); });
  }); }
  function openTypesEdit() { openEditModal("セクション種別の編集", state.config.section_types || [], function (items) {
    return Api.updateConfig({ section_types: items }).then(function () { state.config.section_types = items; Store.setSectionTypes(items); fillRegSelects(); renderReg(); });
  }); }
  function openCategoryEdit() { openEditModal("問題種別の編集", state.config.question_categories || [], function (items) {
    return Api.updateConfig({ question_categories: items }).then(function () { state.config.question_categories = items; fillRegSelects(); });
  }); }
  function openUniversityEdit() {
    // 大学は API 由来。追加はローカルに保持（登録時に自動作成）、削除は API。並び替えはローカル表示。
    openEditModal("大学名の編集", state.universities.map(function (u) { return u.name; }), function (items) {
      // 追加された新規大学名は登録時に作成される。ローカル順序を反映。
      var existing = state.universities.slice();
      var byName = {}; existing.forEach(function (u) { byName[u.name] = u; });
      // 削除されたものを API 削除
      var removed = existing.filter(function (u) { return items.indexOf(u.name) < 0; });
      var ops = removed.map(function (u) { return Api.deleteUniversity(u.id).catch(function () {}); });
      return Promise.all(ops).then(function () {
        state.universities = items.map(function (n) { return byName[n] || { id: null, name: n }; });
        fillRegSelects(); fillSelect(el("sm-university"), items, "指定なし");
      });
    });
  }

  /* ================= タブ5: コーパス検索設定 ================= */
  // type: 'sw'=ストップワード(Worker) / 'lv'=レベル別語彙(Worker) / 'vc'=語彙カバー率(localStorage)
  var wlCtx = null; // { type, index, id, isNew }
  var WL_LABEL = { sw: "（ストップワード）", lv: "（レベル別語彙）", vc: "（語彙リスト）" };
  var WL_ICON  = { sw: "fa-ban", lv: "fa-layer-group", vc: "fa-list-check" };
  var LEVEL_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

  function wireCorpusSettings() {
    el("sw-add").addEventListener("click", function () { openWordList("sw", -1, []); });
    el("lv-add").addEventListener("click", function () { openWordList("lv", -1, []); });
    el("vc-add").addEventListener("click", function () { openWordList("vc", -1, []); });
    el("wordlist-save").addEventListener("click", saveWordList);
    el("wordlist-delete").addEventListener("click", deleteWordList);
    el("wordlist-words").addEventListener("input", updateWordCount);
  }
  // コーパス設定タブ表示時：Worker から共有リストを取り込んでから描画
  function loadWordLists() {
    Store.hydrateWordLists().then(renderWordLists, renderWordLists);
  }
  function renderWordLists() {
    renderWLContainer("sw", el("sw-lists"), Store.getStopLists());
    renderWLContainer("lv", el("lv-lists"), Store.getLevelLists());
    renderWLContainer("vc", el("vc-lists"), Store.getVocabLists());
  }
  function wlCount(type, l) {
    return type === "lv" ? Object.keys(l.levels || {}).length : (l.words || []).length;
  }
  function renderWLContainer(type, container, lists) {
    container.innerHTML = "";
    if (!lists.length) { container.innerHTML = '<p class="hint">まだリストがありません。「新規リスト」から作成してください。</p>'; return; }
    var grid = create("div", { class: "tag-list", style: "display:flex;flex-direction:column;gap:8px" });
    lists.forEach(function (l, i) {
      var badge = l.builtin ? ' <span class="pill em" style="font-size:11px">内蔵</span>' : "";
      var editBtn = l.builtin ? "" : '<button class="icon-btn sm" data-wledit="' + i + '"><i class="fa-solid fa-pen"></i></button>';
      var row = create("div", { class: "sort-item" },
        '<i class="fa-solid ' + WL_ICON[type] + '" style="color:var(--emerald-dark)"></i>' +
        '<span class="label"><strong>' + esc(l.name) + "</strong>" + badge + ' <span class="hint">（' + wlCount(type, l) + " 語）</span></span>" +
        '<span class="move">' + editBtn + "</span>");
      grid.appendChild(row);
    });
    container.appendChild(grid);
    $all("[data-wledit]", container).forEach(function (b) {
      b.addEventListener("click", function () { openWordList(type, Number(b.getAttribute("data-wledit")), lists); });
    });
  }
  function wlSerialize(type, l) {
    if (type === "lv") {
      var lv = l.levels || {};
      return Object.keys(lv).sort(function (a, b) {
        var d = (LEVEL_ORDER[lv[a]] || 9) - (LEVEL_ORDER[lv[b]] || 9);
        return d || (a < b ? -1 : 1);
      }).map(function (w) { return w + " " + lv[w]; }).join("\n");
    }
    return (l.words || []).join("\n");
  }
  function openWordList(type, index, lists) {
    var l = index >= 0 ? lists[index] : null;
    wlCtx = { type: type, index: index, id: (l && l.id) || null, isNew: index < 0 };
    el("wordlist-title").textContent = (index >= 0 ? "リストを編集" : "新規リスト") + WL_LABEL[type];
    el("wordlist-name").value = l ? l.name : "";
    el("wordlist-words").value = l ? wlSerialize(type, l) : "";
    el("wordlist-words").placeholder = type === "lv" ? "abandon B2\nability A2\nabout A1\n…" : "apple\nbanana\n…";
    el("wordlist-delete").style.display = index >= 0 ? "" : "none";
    updateWordCount();
    UI.openModal(el("wordlist-modal"));
  }
  function parseWords(raw) {
    return String(raw || "").split(/[\s,，、]+/).map(function (w) { return w.trim(); }).filter(function (w) { return w.length > 0; });
  }
  // 「語 レベル」形式の各行を { word: LEVEL } へ。レベルは A1〜C2 のみ採用。
  function parseLevelPairs(raw) {
    var map = {};
    String(raw || "").split(/\r?\n/).forEach(function (line) {
      var m = line.trim().match(/^(.+?)[\s,，、\t]+([A-Ca-c][12])\s*$/);
      if (!m) return;
      var w = m[1].toLowerCase().trim(), lv = m[2].toUpperCase();
      if (w && LEVEL_ORDER[lv]) map[w] = lv;
    });
    return map;
  }
  function updateWordCount() {
    var raw = el("wordlist-words").value;
    var n = (wlCtx && wlCtx.type === "lv") ? Object.keys(parseLevelPairs(raw)).length : parseWords(raw).length;
    el("wordlist-count").textContent = n + " 語";
  }
  function saveWordList() {
    var name = el("wordlist-name").value.trim();
    if (!name) { toast("リスト名を入力してください", "err"); return; }
    var raw = el("wordlist-words").value;

    // 語彙カバー率リストは localStorage（従来通り）
    if (wlCtx.type === "vc") {
      var words = parseWords(raw);
      var lists = Store.getVocabLists(); // 内蔵リストが先頭に含まれる
      if (wlCtx.isNew) lists.push({ name: name, words: words });
      else lists[wlCtx.index] = { name: name, words: words };
      // 内蔵リストは localStorage に保存しない
      Store.setVocabLists(lists.filter(function (l) { return !l.builtin; }));
      UI.closeModal(el("wordlist-modal"));
      renderWordLists();
      toast("保存しました", "ok");
      return;
    }

    // ストップワード / レベル別語彙は Worker(D1) に保存
    if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です。接続設定で登録してください。", "err"); return; }
    var wtype = wlCtx.type === "sw" ? "stop" : "level";
    var data = wlCtx.type === "sw" ? parseWords(raw) : parseLevelPairs(raw);
    var p = wlCtx.isNew
      ? Api.createWordList({ type: wtype, name: name, data: data })
      : Api.updateWordList(wlCtx.id, { name: name, data: data });
    p.then(function () { return Store.hydrateWordLists(); })
      .then(function () { UI.closeModal(el("wordlist-modal")); renderWordLists(); toast("保存しました", "ok"); })
      .catch(function (e) { toast(e.message, "err"); });
  }
  function deleteWordList() {
    if (!confirm("このリストを削除しますか？")) return;
    if (wlCtx.type === "vc") {
      var lists = Store.getVocabLists();
      lists.splice(wlCtx.index, 1);
      // 内蔵リストは localStorage に保存しない
      Store.setVocabLists(lists.filter(function (l) { return !l.builtin; }));
      UI.closeModal(el("wordlist-modal"));
      renderWordLists();
      toast("削除しました", "ok");
      return;
    }
    if (!wlCtx.id) { UI.closeModal(el("wordlist-modal")); return; }
    Api.deleteWordList(wlCtx.id)
      .then(function () { return Store.hydrateWordLists(); })
      .then(function () { UI.closeModal(el("wordlist-modal")); renderWordLists(); toast("削除しました", "ok"); })
      .catch(function (e) { toast(e.message, "err"); });
  }

  function noWorker() {
    return '<div class="card"><div class="empty"><i class="fa-solid fa-plug-circle-xmark ic"></i>Worker URL が未設定です。「接続設定」タブで登録してください。</div></div>';
  }

  // 汎用編集モーダルの保存ボタン
  function wireEditModal() {
    el("edit-add").addEventListener("click", function () {
      var v = el("edit-new").value.trim(); if (!v) return;
      if (state.editCtx.items.indexOf(v) < 0) state.editCtx.items.push(v);
      el("edit-new").value = ""; renderEditList();
    });
    el("edit-new").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); el("edit-add").click(); } });
    el("edit-save").addEventListener("click", function () {
      var r = state.editCtx.onSave(state.editCtx.items);
      Promise.resolve(r).then(function () { UI.closeModal(el("edit-modal")); toast("保存しました", "ok"); })
        .catch(function (e) { toast(e.message || "保存に失敗しました", "err"); });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    wireSearchModalTabs();
    wireEditModal();
  });
})();
