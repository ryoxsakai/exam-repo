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
    corpus:   { id: "corpus",   label: "コーパス検索設定", icon: "fa-language" }
  };
  var SET_ORDER = ["main", "conn", "list", "register", "corpus"];
  var MAIN_TABS = { search: { label: "通常検索", icon: "fa-table-list" }, corpus: { label: "コーパス検索", icon: "fa-language" } };
  var MAIN_ORDER = ["search", "corpus"];

  var state = {
    config: { schedules: [], year_presets: [] },
    universities: [],
    list: { filter: { word: "", universityName: "", year: "", schedule: "", qnum: "" }, rows: [], sort: { key: "year", dir: "desc" } },
    reg: { sections: [], editingExamId: null },
    editCtx: null  // 汎用編集モーダルの対象
  };

  /* ---------------- 初期化 ---------------- */
  function init() {
    el("site-title").textContent = Store.getSiteTitle();
    document.title = "設定 — " + Store.getSiteTitle();

    var order = Store.getTabOrder("setting", SET_ORDER);
    var active = Store.getLastTab("setting");
    if (SET_ORDER.indexOf(active) < 0) active = order[0];
    UI.buildTabs({
      tabsEl: el("set-tabs"), order: order, defs: SET_TABS, active: active,
      onChange: function (id) { Store.setLastTab("setting", id); onTab(id); }
    });
    UI.setActiveTab(el("set-tabs"), active);

    // モーダル配線
    ["edit-modal", "search-modal", "exam-modal", "wordlist-modal", "preview-modal"].forEach(function (id) { UI.wireModal(el(id)); });

    wireMain();
    wireConn();
    wireList();
    wireRegister();
    wireCorpusSettings();

    // 接続済みなら設定読み込み
    el("cfg-worker").value = Store.getWorkerUrl();
    if (Store.getWorkerUrl()) loadServerConfig();
    onTab(active);
  }

  function onTab(id) {
    if (id === "list") loadList();
    if (id === "register") renderReg();
    if (id === "corpus") renderWordLists();
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
    renderOrderList("main", MAIN_TABS, MAIN_ORDER, el("order-main"));
    renderOrderList("setting", SET_TABS, SET_ORDER, el("order-setting"));
  }

  function renderOrderList(page, defs, defOrder, container) {
    var order = Store.getTabOrder(page, defOrder);
    container.innerHTML = "";
    order.forEach(function (id, i) {
      var def = defs[id]; if (!def) return;
      var li = create("li", { class: "sort-item" },
        '<i class="fa-solid ' + def.icon + '" style="color:var(--emerald-dark)"></i>' +
        '<span class="label">' + esc(def.label) + "</span>" +
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
  }
  function moveOrder(page, defOrder, idx, delta, defs, container) {
    var order = Store.getTabOrder(page, defOrder);
    var j = idx + delta;
    if (j < 0 || j >= order.length) return;
    var tmp = order[idx]; order[idx] = order[j]; order[j] = tmp;
    Store.setTabOrder(page, order);
    renderOrderList(page, defs, defOrder, container);
    // 設定ページ自身のタブは即時反映
    if (page === "setting") UI.buildTabs({ tabsEl: el("set-tabs"), order: order, defs: SET_TABS, active: Store.getLastTab("setting") || order[0], onChange: function (id) { Store.setLastTab("setting", id); onTab(id); } });
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
  }

  function loadServerConfig() {
    return Promise.all([
      Api.getConfig().catch(function () { return { schedules: [], year_presets: [] }; }),
      Api.getUniversities().catch(function () { return { universities: [] }; })
    ]).then(function (res) {
      state.config = res[0] || { schedules: [], year_presets: [] };
      if (!Array.isArray(state.config.schedules)) state.config.schedules = [];
      if (!Array.isArray(state.config.year_presets)) state.config.year_presets = [];
      state.universities = (res[1] && res[1].universities) || [];
      // 検索モーダルの選択肢
      fillSelect(el("sm-year"), state.config.year_presets, "指定なし");
      fillSelect(el("sm-schedule"), state.config.schedules, "指定なし");
      fillSelect(el("sm-university"), state.universities.map(function (u) { return u.name; }), "指定なし");
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
  function wireList() {
    el("list-search").addEventListener("click", function () { openSearchModal(runListSearch); });
    el("list-clear").addEventListener("click", function () {
      state.list.filter = { word: "", universityName: "", year: "", schedule: "", qnum: "" };
      loadList();
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
    el("list-summary").textContent = parts.length ? parts.join(" / ") : "すべての入試問題";
    el("list-area").innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> 読み込み中…</div></div>';
    Api.search({ word: f.word, universityName: f.universityName, year: f.year, schedule: f.schedule }).then(function (data) {
      var rows = (data.results || []).map(function (r) {
        return { exam_id: r.exam_id, university_name: r.university_name, year: r.year, schedule: r.schedule, question_count: r.question_count, matching: r.matching_questions || "" };
      });
      if (f.qnum) rows = rows.filter(function (r) {
        var list = String(r.matching).split(",").map(function (s) { return s.trim(); });
        return list.indexOf(f.qnum) >= 0 || r.question_count >= Number(f.qnum);
      });
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
      if (key === "year" || key === "question_count") { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av || "").toLowerCase(); bv = String(bv || "").toLowerCase(); }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    if (!rows.length) { el("list-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>該当する入試問題がありません。</div></div>'; return; }
    var cols = [{ key: "year", label: "年度" }, { key: "university_name", label: "大学名" }, { key: "schedule", label: "方式" }, { key: "question_count", label: "大問数" }];
    var html = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) {
      var sorted = state.list.sort.key === c.key;
      var ic = sorted ? (state.list.sort.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort";
      html += '<th class="sortable' + (sorted ? " sorted" : "") + '" data-sort="' + c.key + '">' + esc(c.label) + '<i class="fa-solid ' + ic + ' sort-ic"></i></th>';
    });
    html += '<th style="text-align:right">操作</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += "<tr>" +
        '<td><span class="pill em">' + esc(r.year) + "</span></td><td><strong>" + esc(r.university_name) + "</strong></td><td>" + esc(r.schedule) + "</td><td>" + esc(r.question_count) + "</td>" +
        '<td class="row-actions">' +
        '<button class="icon-btn" data-view="' + r.exam_id + '" title="表示"><i class="fa-solid fa-eye"></i></button>' +
        '<button class="icon-btn" data-edit="' + r.exam_id + '" title="編集"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="icon-btn danger" data-del="' + r.exam_id + '" title="削除"><i class="fa-solid fa-trash"></i></button>' +
        "</td></tr>";
    });
    html += "</tbody></table></div>";
    el("list-area").innerHTML = html;
    $all("th.sortable", el("list-area")).forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-sort");
        if (state.list.sort.key === k) state.list.sort.dir = state.list.sort.dir === "asc" ? "desc" : "asc";
        else { state.list.sort.key = k; state.list.sort.dir = (k === "year" || k === "question_count") ? "desc" : "asc"; }
        renderListTable();
      });
    });
    $all("[data-view]", el("list-area")).forEach(function (b) { b.addEventListener("click", function () { openExam(Number(b.getAttribute("data-view"))); }); });
    $all("[data-edit]", el("list-area")).forEach(function (b) { b.addEventListener("click", function () { loadExamIntoForm(Number(b.getAttribute("data-edit"))); }); });
    $all("[data-del]", el("list-area")).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("この入試問題を削除しますか？（大問もすべて削除されます）")) return;
        Api.deleteExam(Number(b.getAttribute("data-del"))).then(function () { toast("削除しました", "ok"); loadList(); })
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
    el("sm-schedule").value = f.schedule; el("sm-qnum").value = f.qnum;
    UI.openModal(el("search-modal"));
  }
  function readSearchModal() {
    return { word: el("sm-word").value.trim(), universityName: el("sm-university").value, year: el("sm-year").value, schedule: el("sm-schedule").value, qnum: el("sm-qnum").value.trim() };
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
  function openExam(examId) {
    UI.openModal(el("exam-modal"));
    el("exam-modal-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      el("exam-modal-title").textContent = ex.year + "年 " + ex.university_name + " " + ex.schedule;
      var body = "";
      (ex.questions || []).forEach(function (q) {
        body += '<div class="exam-section">';
        body += field("問題", "fa-circle-question", q.problem_text);
        if (q.answer_text && q.answer_text.trim()) body += field("解答", "fa-circle-check", q.answer_text);
        if (q.commentary_text && q.commentary_text.trim()) body += field("解説", "fa-comment-dots", q.commentary_text);
        body += "</div>";
      });
      el("exam-modal-body").innerHTML = body || '<div class="empty">大問が登録されていません。</div>';
    }).catch(function (e) { el("exam-modal-body").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
  }
  function field(label, icon, text) {
    return '<div style="margin-bottom:14px"><div class="exam-section-title"><i class="fa-solid ' + icon + '"></i> ' + esc(label) +
      '</div><div class="exam-doc">' + Markup.render(text).html + "</div></div>";
  }

  /* ================= タブ4: 問題登録 ================= */
  var SECTION_ICONS = { "問題": "fa-circle-question", "解答": "fa-circle-check", "解説": "fa-comment-dots" };

  function wireRegister() {
    el("reg-add-section").addEventListener("click", function () { addSection(); renderReg(); });
    el("reg-reset").addEventListener("click", resetReg);
    el("reg-save").addEventListener("click", saveReg);
    el("reg-preview").addEventListener("click", previewReg);
    el("reg-year-edit").addEventListener("click", function () { openYearEdit(); });
    el("reg-sched-edit").addEventListener("click", function () { openScheduleEdit(); });
    el("reg-uni-edit").addEventListener("click", function () { openUniversityEdit(); });
    el("reg-types-edit").addEventListener("click", function () { openTypesEdit(); });
    if (!state.reg.sections.length) { addSection("問題"); addSection("解答"); }
  }
  function addSection(type) {
    var types = Store.getSectionTypes();
    state.reg.sections.push({ type: type || types[0], text: "" });
  }
  function fillRegSelects() {
    fillSelect(el("reg-year"), state.config.year_presets, "—");
    fillSelect(el("reg-schedule"), state.config.schedules, "—");
    fillSelect(el("reg-university"), state.universities.map(function (u) { return u.name; }), "—");
  }
  function renderReg() {
    fillRegSelects();
    el("reg-mode-label").textContent = state.reg.editingExamId ? "問題を編集（ID:" + state.reg.editingExamId + "）" : "新規 問題登録";
    var types = Store.getSectionTypes();
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
          '<button class="icon-btn sm danger" data-secdel="' + i + '" title="削除"><i class="fa-solid fa-trash"></i></button>' +
        "</div>" +
        markupBar(i) +
        '<textarea data-sectext="' + i + '" rows="6" placeholder="入試問題記法で入力…">' + esc(sec.text) + "</textarea>";
      c.appendChild(box);
    });
    wireRegSection();
  }
  function markupBar(i) {
    var btns = [
      { l: '{{問}}', t: "問見出し", b: "{{問", a: "}}" },
      { l: "空所 [[ ]]", t: "空所", b: "[[", a: "]]" },
      { l: "選択肢 (( ))", t: "選択肢", b: "((", a: "))" },
      { l: "ハイライト", t: "ハイライト", b: "==", a: "==" },
      { l: "色ハイライト", t: "色付きハイライト", b: "==", a: "==:yellow" },
      { l: "下線", t: "下線", b: "__", a: "__" },
      { l: "語注", t: "語注", b: "##", a: "::訳##" },
      { l: "下付き", t: "下付き", b: "~~", a: "~~" },
      { l: "上付き", t: "上付き", b: "^^", a: "^^" },
      { l: "区切り", t: "区切り線", b: "\n----\n", a: "" }
    ];
    var h = '<div class="markup-bar">';
    btns.forEach(function (bn, k) {
      h += '<button class="btn sm" data-mk="' + i + ":" + k + '" title="' + esc(bn.t) + '">' + esc(bn.l) + "</button>";
    });
    h += "</div>";
    return h;
  }
  var MK_DEFS = [
    { b: "{{問", a: "}}" }, { b: "[[", a: "]]" }, { b: "((", a: "))" }, { b: "==", a: "==" },
    { b: "==", a: "==:yellow" }, { b: "__", a: "__" }, { b: "##", a: "::訳##" }, { b: "~~", a: "~~" },
    { b: "^^", a: "^^" }, { b: "\n----\n", a: "" }
  ];
  function wireRegSection() {
    var c = el("reg-sections");
    $all("[data-sectype]", c).forEach(function (s) { s.addEventListener("change", function () { state.reg.sections[Number(s.getAttribute("data-sectype"))].type = s.value; }); });
    $all("[data-sectext]", c).forEach(function (t) { t.addEventListener("input", function () { state.reg.sections[Number(t.getAttribute("data-sectext"))].text = t.value; }); });
    $all("[data-secup]", c).forEach(function (b) { b.addEventListener("click", function () { moveSection(Number(b.getAttribute("data-secup")), -1); }); });
    $all("[data-secdown]", c).forEach(function (b) { b.addEventListener("click", function () { moveSection(Number(b.getAttribute("data-secdown")), 1); }); });
    $all("[data-secdel]", c).forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-secdel"));
        state.reg.sections.splice(i, 1);
        if (!state.reg.sections.length) addSection("問題");
        renderReg();
      });
    });
    $all("[data-mk]", c).forEach(function (b) {
      b.addEventListener("click", function () {
        var parts = b.getAttribute("data-mk").split(":");
        var i = Number(parts[0]), k = Number(parts[1]);
        var ta = $('[data-sectext="' + i + '"]', c);
        insertMarkup(ta, MK_DEFS[k].b, MK_DEFS[k].a);
        state.reg.sections[i].text = ta.value;
      });
    });
  }
  function moveSection(i, delta) {
    var j = i + delta; if (j < 0 || j >= state.reg.sections.length) return;
    var tmp = state.reg.sections[i]; state.reg.sections[i] = state.reg.sections[j]; state.reg.sections[j] = tmp;
    renderReg();
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
    var problem = [], answer = [], commentary = [];
    state.reg.sections.forEach(function (sec) {
      var t = sec.text || "";
      if (sec.type === "解答") answer.push(t);
      else if (sec.type === "解説") commentary.push(t);
      else problem.push((sec.type !== "問題" ? "{{" + sec.type + "}}\n" : "") + t);
    });
    return {
      universityName: uni, year: Number(year), schedule: sched,
      questions: [{ questionNumber: qnum, problemText: problem.join("\n\n"), answerText: answer.join("\n\n"), commentaryText: commentary.join("\n\n") }]
    };
  }
  function saveReg() {
    var data = collectReg();
    if (!data.year || !data.universityName || !data.schedule) { toast("年度・大学名・方式を選択してください", "err"); return; }
    var p = state.reg.editingExamId ? Api.updateExam(state.reg.editingExamId, data) : Api.createExam(data);
    p.then(function () {
      toast(state.reg.editingExamId ? "更新しました" : "登録しました", "ok");
      resetReg();
      loadServerConfig();
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function resetReg() {
    state.reg.editingExamId = null;
    state.reg.sections = [];
    addSection("問題"); addSection("解答");
    el("reg-qnum").value = "1";
    renderReg();
  }
  function previewReg() {
    var data = collectReg();
    var q = data.questions[0];
    var body = '<div class="exam-section">' + field("問題", "fa-circle-question", q.problemText);
    if (q.answerText.trim()) body += field("解答", "fa-circle-check", q.answerText);
    if (q.commentaryText.trim()) body += field("解説", "fa-comment-dots", q.commentaryText);
    body += "</div>";
    el("preview-body").innerHTML = body;
    UI.openModal(el("preview-modal"));
  }
  function loadExamIntoForm(examId) {
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      var q = (ex.questions || [])[0] || { question_number: 1, problem_text: "", answer_text: "", commentary_text: "" };
      state.reg.editingExamId = examId;
      state.reg.sections = [];
      if (q.problem_text) state.reg.sections.push({ type: "問題", text: q.problem_text });
      if (q.answer_text) state.reg.sections.push({ type: "解答", text: q.answer_text });
      if (q.commentary_text) state.reg.sections.push({ type: "解説", text: q.commentary_text });
      if (!state.reg.sections.length) addSection("問題");
      UI.setActiveTab(el("set-tabs"), "register"); Store.setLastTab("setting", "register");
      renderReg();
      el("reg-year").value = ex.year; el("reg-university").value = ex.university_name; el("reg-schedule").value = ex.schedule;
      el("reg-qnum").value = q.question_number || 1;
      toast("編集モードで読み込みました", "ok");
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
  function openTypesEdit() { openEditModal("セクション種別の編集", Store.getSectionTypes(), function (items) {
    Store.setSectionTypes(items); renderReg(); return Promise.resolve();
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
  var wlCtx = null; // {type:'sw'|'vc', index, isNew}
  function wireCorpusSettings() {
    el("sw-add").addEventListener("click", function () { openWordList("sw", -1); });
    el("vc-add").addEventListener("click", function () { openWordList("vc", -1); });
    el("wordlist-save").addEventListener("click", saveWordList);
    el("wordlist-delete").addEventListener("click", deleteWordList);
    el("wordlist-words").addEventListener("input", updateWordCount);
  }
  function renderWordLists() {
    renderWLContainer("sw", el("sw-lists"), Store.getStopwordLists());
    renderWLContainer("vc", el("vc-lists"), Store.getVocabLists());
  }
  function renderWLContainer(type, container, lists) {
    container.innerHTML = "";
    if (!lists.length) { container.innerHTML = '<p class="hint">まだリストがありません。「新規リスト」から作成してください。</p>'; return; }
    var grid = create("div", { class: "tag-list", style: "display:flex;flex-direction:column;gap:8px" });
    lists.forEach(function (l, i) {
      var row = create("div", { class: "sort-item" },
        '<i class="fa-solid ' + (type === "sw" ? "fa-ban" : "fa-list-check") + '" style="color:var(--emerald-dark)"></i>' +
        '<span class="label"><strong>' + esc(l.name) + '</strong> <span class="hint">（' + l.words.length + " 語）</span></span>" +
        '<span class="move"><button class="icon-btn sm" data-wledit="' + i + '"><i class="fa-solid fa-pen"></i></button></span>');
      grid.appendChild(row);
    });
    container.appendChild(grid);
    $all("[data-wledit]", container).forEach(function (b) { b.addEventListener("click", function () { openWordList(type, Number(b.getAttribute("data-wledit"))); }); });
  }
  function openWordList(type, index) {
    wlCtx = { type: type, index: index, isNew: index < 0 };
    var lists = type === "sw" ? Store.getStopwordLists() : Store.getVocabLists();
    var l = index >= 0 ? lists[index] : { name: "", words: [] };
    el("wordlist-title").textContent = (index >= 0 ? "リストを編集" : "新規リスト") + (type === "sw" ? "（ストップワード）" : "（語彙リスト）");
    el("wordlist-name").value = l.name;
    el("wordlist-words").value = l.words.join("\n");
    el("wordlist-delete").style.display = index >= 0 ? "" : "none";
    updateWordCount();
    UI.openModal(el("wordlist-modal"));
  }
  function parseWords(raw) {
    return String(raw || "").split(/[\s,，、]+/).map(function (w) { return w.trim(); }).filter(function (w) { return w.length > 0; });
  }
  function updateWordCount() { el("wordlist-count").textContent = parseWords(el("wordlist-words").value).length + " 語"; }
  function saveWordList() {
    var name = el("wordlist-name").value.trim();
    if (!name) { toast("リスト名を入力してください", "err"); return; }
    var words = parseWords(el("wordlist-words").value);
    var lists = wlCtx.type === "sw" ? Store.getStopwordLists() : Store.getVocabLists();
    if (wlCtx.isNew) lists.push({ name: name, words: words });
    else lists[wlCtx.index] = { name: name, words: words };
    if (wlCtx.type === "sw") Store.setStopwordLists(lists); else Store.setVocabLists(lists);
    UI.closeModal(el("wordlist-modal"));
    renderWordLists();
    toast("保存しました", "ok");
  }
  function deleteWordList() {
    if (!confirm("このリストを削除しますか？")) return;
    var lists = wlCtx.type === "sw" ? Store.getStopwordLists() : Store.getVocabLists();
    lists.splice(wlCtx.index, 1);
    if (wlCtx.type === "sw") Store.setStopwordLists(lists); else Store.setVocabLists(lists);
    UI.closeModal(el("wordlist-modal"));
    renderWordLists();
    toast("削除しました", "ok");
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
