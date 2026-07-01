/* =====================================================================
   settings.js — 設定ページ (setting/index.html) のロジック
   ===================================================================== */
(function () {
  "use strict";
  var el = UI.el, $ = UI.$, $all = UI.$all, create = UI.create, esc = UI.escapeHtml, toast = UI.toast;

  // 大問の表示用文字列。label があればそれを、無ければ question_number を返す（「大問」+これ）
  function qLabel(q) {
    return (q && q.label != null && String(q.label).trim()) ? String(q.label) : String(q && q.question_number);
  }

  var SET_TABS = {
    main:     { id: "main",     label: "メイン設定",       icon: "fa-sliders" },
    conn:     { id: "conn",     label: "接続設定",         icon: "fa-plug" },
    list:     { id: "list",     label: "入試問題一覧",     icon: "fa-table-list" },
    uniyomi:  { id: "uniyomi",  label: "大学のよみがな",   icon: "fa-arrow-down-a-z" },
    register: { id: "register", label: "問題登録",         icon: "fa-pen-to-square" },
    ingest:    { id: "ingest",    label: "PDF取り込み",      icon: "fa-file-import" },
    ingestcfg: { id: "ingestcfg", label: "取り込み設定",      icon: "fa-wand-magic-sparkles" },
    replace:   { id: "replace",   label: "登録データ置換",   icon: "fa-right-left" },
    extllm:    { id: "extllm",    label: "外部LLM取り込み",  icon: "fa-robot" },
    corpus:    { id: "corpus",    label: "コーパス検索設定", icon: "fa-language" }
  };
  var SET_ORDER = ["main", "conn", "list", "uniyomi", "register", "ingest", "ingestcfg", "replace", "extllm", "corpus"];
  var MAIN_TABS = { tree: { label: "ツリー検索", icon: "fa-sitemap" }, search: { label: "通常検索", icon: "fa-table-list" }, corpus: { label: "コーパス検索", icon: "fa-language" }, print: { label: "問題印刷", icon: "fa-print" } };
  var MAIN_ORDER = ["tree", "search", "corpus", "print"];

  var state = {
    config: { schedules: [], year_presets: [], question_categories: [], section_types: [] },
    bulk: [],  // 登録データ一括置換ルール [{from,to,regex}]
    ing: { universityName: "", year: "", schedule: "", truncated: false, questions: [] },  // PDF取り込み解析結果
    universities: [],
    list: { filter: { word: "", universityName: "", year: "", schedule: "", qnum: "", category: "" }, rows: [], sortedRows: [], sort: { key: "year", dir: "desc" }, nav: { examId: null, qnum: null } },
    reg: { sections: [], editingExamId: null, meta: { year: "", university: "", schedule: "", qnum: "1", category: "" } },
    editCtx: null,  // 汎用編集モーダルの対象
    corpus: null,   // 難易度帯の基準用（全大問の英文。取得後キャッシュ）
    longLevel: null // 長文レベルのキャッシュ {src, wv, byKey, cutoffs}
  };

  /* ---------------- 初期化 ---------------- */
  function init() {
    el("site-title").textContent = Store.getSiteTitle();
    el("site-subtitle").textContent = Store.getSiteSubtitle();
    document.title = "設定 — " + Store.getSiteTitle();
    UI.applyDomainLinks();
    if (Markup.setImageBase) Markup.setImageBase(Store.getWorkerUrl() || "");

    var order = Store.getTabOrder("setting", SET_ORDER);
    var active = Store.getLastTab("setting");
    if (SET_ORDER.indexOf(active) < 0) active = order[0];
    rebuildSetTabs(order, active);
    UI.setActiveTab(el("set-tabs"), active);

    // モーダル配線
    ["edit-modal", "label-batch-modal", "search-modal", "exam-modal", "wordlist-modal", "preview-modal", "syntax-modal", "regex-help-modal"].forEach(function (id) { UI.wireModal(el(id)); });

    wireMain();
    wireConn();
    wireList();
    wireUniYomi();
    wireRegister();
    wireIngest();
    wireIngestConfig();
    wireReplaceTab();
    wireExtLlm();
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
    if (id === "uniyomi") loadUniYomi();
    if (id === "register") renderReg();
    if (id === "replace") renderBulkList();
    if (id === "extllm") loadExtPrompt();
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
    // R2 画像ストレージのアップロードテスト（1x1 PNG を実送信）
    if (el("r2-test")) el("r2-test").addEventListener("click", function () {
      if (!Store.getWorkerUrl()) { el("r2-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> Worker URL が未設定です</span>'; return; }
      el("r2-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> テスト中…';
      var b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      var bin = atob(b64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var blob = new Blob([arr], { type: "image/png" });
      Api.uploadImage(blob).then(function (r) {
        el("r2-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> OK（R2 への保存・配信が有効です）</span>';
        toast("R2 アップロードテスト成功", "ok");
      }).catch(function (e) {
        el("r2-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
        toast("R2 テストに失敗しました", "err");
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
  // 取り込み編集で使うセクション種別（本文・設問・全訳を必ず含める）
  function ingSectionTypes() {
    var base = (state.config.section_types && state.config.section_types.length)
      ? state.config.section_types.slice() : ["問題", "本文", "設問", "解答", "解説", "全訳"];
    ["本文", "設問", "全訳"].forEach(function (t) { if (base.indexOf(t) < 0) base.push(t); });
    return base;
  }
  // 読み取り値を既存候補に寄せる（例: 「一般前期」が無ければ「前期」）
  function bestExisting(value, options) {
    value = String(value == null ? "" : value).trim();
    if (!value || !Array.isArray(options) || !options.length) return value;
    if (options.indexOf(value) >= 0) return value;
    var cand = options.slice().sort(function (a, b) { return String(b).length - String(a).length; });
    for (var i = 0; i < cand.length; i++) { if (cand[i] && value.indexOf(cand[i]) >= 0) return cand[i]; }
    for (var j = 0; j < cand.length; j++) { if (cand[j] && String(cand[j]).indexOf(value) >= 0) return cand[j]; }
    return value;
  }
  function ingTypeOptions(cur) {
    var types = ingSectionTypes();
    if (cur && types.indexOf(cur) < 0) types = types.concat([cur]);
    return types.map(function (t) {
      return '<option value="' + esc(t) + '"' + (t === cur ? " selected" : "") + ">" + esc(t) + "</option>";
    }).join("");
  }
  // 新規セクションの既定種別：未使用の標準種別を順に選ぶ
  function nextIngType(q) {
    var order = ["解答", "解説", "全訳", "問題"];
    for (var i = 0; i < order.length; i++) {
      if (!q.sections.some(function (s) { return s.type === order[i]; })) return order[i];
    }
    return "問題";
  }

  // 大学名の表記ゆれを統一（「愛知医科大学 / 愛知医科大 / 愛知医科大学（医）」→「愛知医科」）。
  // Worker 側 normalizeUniversityName と同一ルール。取り込み結果の表示にも反映する。
  function normalizeUniName(name) {
    var n = String(name == null ? "" : name).trim();
    if (!n) return n;
    var prev;
    do { prev = n; n = n.replace(/[（(][^（）()]*[）)]\s*$/, "").trim(); } while (n !== prev);
    if (/大学$/.test(n)) n = n.replace(/大学$/, "");
    else if (/大$/.test(n)) n = n.replace(/大$/, "");
    n = n.trim();
    return n || String(name == null ? "" : name).trim();
  }

  // AI 解析結果（sections 形式 / 旧 problemText 形式の両対応）を state.ing へ
  // 方式・種別は既存候補に寄せる（無ければ読み取り値のまま）
  function ingestToState(data) {
    var qs = (data && Array.isArray(data.questions)) ? data.questions : [];
    var schedules = state.config.schedules || [];
    var cats = state.config.question_categories || [];
    return {
      universityName: normalizeUniName((data && data.universityName) || ""),
      year: (data && data.year) || "",
      schedule: bestExisting((data && data.schedule) || "", schedules),
      truncated: !!(data && data._truncated),
      questions: qs.map(function (q, i) {
        var sections = [];
        if (Array.isArray(q.sections) && q.sections.length) {
          sections = q.sections.map(function (s) { return { type: s.type || "問題", text: s.text || "" }; });
        } else {
          // 後方互換：旧フィールドからセクションを生成
          if (q.problemText) {
            Markup.parseSections(q.problemText).forEach(function (s) { sections.push({ type: s.type, text: s.text }); });
          }
          if (q.answerText && q.answerText.trim()) sections.push({ type: "解答", text: q.answerText });
          if (q.commentaryText && q.commentaryText.trim()) sections.push({ type: "解説", text: q.commentaryText });
        }
        if (!sections.length) sections.push({ type: "問題", text: "" });
        return {
          questionNumber: Number(q.questionNumber) || (i + 1),
          category: bestExisting(q.category || "", cats),
          sections: sections
        };
      })
    };
  }

  function renderIngestResult(data) {
    state.ing = ingestToState(data);
    renderIngest();
  }

  // DOM の現在値を state.ing に吸い上げる（再描画で消えないように）
  function readIngFromDom() {
    var root = el("ing-result");
    if (!root) return;
    var u = $("#ing-r-university", root), y = $("#ing-r-year", root), s = $("#ing-r-schedule", root);
    if (u) state.ing.universityName = u.value;
    if (y) state.ing.year = y.value;
    if (s) state.ing.schedule = s.value;
    $all("[data-iqcard]", root).forEach(function (card) {
      var q = state.ing.questions[Number(card.getAttribute("data-iqcard"))];
      if (!q) return;
      var num = $(".ing-q-num", card), cat = $(".ing-q-cat", card);
      if (num) q.questionNumber = Number(num.value) || 1;
      if (cat) q.category = cat.value;
      $all("[data-isec]", card).forEach(function (secEl) {
        var sec = q.sections[Number(secEl.getAttribute("data-isec"))];
        if (!sec) return;
        var ty = $(".ing-sec-type", secEl), tx = $(".ing-sec-text", secEl);
        if (ty) sec.type = ty.value;
        if (tx) sec.text = tx.value;
      });
    });
  }

  function renderIngest() {
    var d = state.ing;
    var h = "";
    if (d.truncated) {
      h += '<div class="card"><p class="hint" style="color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i> 出力が長く途中で切れた可能性があります。大問数が多い場合は PDF を分割して取り込んでください。</p></div>';
    }
    h += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-circle-check ic"></i> 解析結果（確認・修正して登録）</h3></div>';
    h += '<div class="reg-meta">';
    h += ingMetaInput("ing-r-university", "大学名", d.universityName || "");
    h += ingMetaInput("ing-r-year", "年度", d.year || "", "number");
    h += ingMetaInput("ing-r-schedule", "方式", d.schedule || "");
    h += "</div></div>";

    d.questions.forEach(function (q, qi) {
      h += '<div class="card" data-iqcard="' + qi + '">';
      h += '<div class="card-head"><h3 style="font-size:14px"><i class="fa-solid fa-hashtag ic"></i> 大問 ' +
        '<input type="number" min="1" class="ing-q-num" style="width:64px" value="' + (Number(q.questionNumber) || (qi + 1)) + '"></h3>' +
        '<input type="text" class="ing-q-cat" placeholder="種別（任意）" value="' + esc(q.category || "") + '" style="width:160px;margin-left:8px">' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn sm danger" data-iqdel="' + qi + '" title="この大問を削除"><i class="fa-solid fa-trash"></i></button></div>';
      q.sections.forEach(function (sec, si) {
        var key = qi + ":" + si;
        h += '<div class="reg-section" data-isec="' + si + '">' +
          '<div class="reg-section-head">' +
            '<select class="ing-sec-type" data-isectype="' + key + '" style="max-width:160px">' + ingTypeOptions(sec.type) + "</select>" +
            '<span class="spacer"></span>' +
            '<button class="icon-btn sm" data-isecpv="' + key + '" title="見え方を確認"><i class="fa-solid fa-file-lines"></i></button>' +
            '<button class="icon-btn sm" data-isecup="' + key + '" title="上へ"' + (si === 0 ? " disabled" : "") + '><i class="fa-solid fa-arrow-up"></i></button>' +
            '<button class="icon-btn sm" data-isecdown="' + key + '" title="下へ"' + (si === q.sections.length - 1 ? " disabled" : "") + '><i class="fa-solid fa-arrow-down"></i></button>' +
            '<button class="icon-btn sm danger" data-isecdel="' + key + '" title="削除"><i class="fa-solid fa-trash"></i></button>' +
          "</div>" +
          ingMarkupBar(key) +
          '<textarea class="ing-sec-text" data-isectext="' + key + '" rows="6" style="width:100%">' + esc(sec.text || "") + "</textarea>" +
        "</div>";
      });
      h += '<div class="toolbar" style="margin-top:8px"><button class="btn sm" data-isecadd="' + qi + '"><i class="fa-solid fa-plus"></i> セクション追加</button></div>';
      h += "</div>";
    });

    h += '<div class="toolbar" style="margin-top:8px">' +
      '<button class="btn" id="ing-add-q"><i class="fa-solid fa-plus"></i> 大問を追加</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn blue" id="ing-preview-all"><i class="fa-solid fa-eye"></i> 全体を表示確認</button>' +
      '<button class="btn primary" id="ing-register"><i class="fa-solid fa-floppy-disk"></i> この内容で登録（全' + d.questions.length + "大問）</button></div>";
    el("ing-result").innerHTML = h;
    wireIngestResult();
  }

  // 取り込み編集用の記法ボタンバー（data-imk="qi:si:k"）
  function ingMarkupBar(key) {
    var h = '<div class="markup-bar">';
    MK_DEFS.forEach(function (bn, k) {
      h += '<button class="btn sm" data-imk="' + key + ":" + k + '" title="' + esc(bn.t) + '">' + esc(bn.l) + "</button>";
    });
    h += '<button class="btn sm" data-imkimg="' + key + '" title="画像を挿入（アップロード）"><i class="fa-solid fa-image"></i> 画像</button>';
    h += '<button class="btn sm link" data-syntax="1" title="記法の一覧と見え方"><i class="fa-solid fa-circle-question"></i> 記法一覧</button>';
    h += "</div>";
    return h;
  }

  function wireIngestResult() {
    var root = el("ing-result");
    // 種別プルダウン・本文：その場で state へ反映（再描画なし）
    $all(".ing-sec-type", root).forEach(function (sel) {
      sel.addEventListener("change", function () {
        var p = sel.getAttribute("data-isectype").split(":");
        state.ing.questions[+p[0]].sections[+p[1]].type = sel.value;
      });
    });
    $all(".ing-sec-text", root).forEach(function (ta) {
      ta.addEventListener("input", function () {
        var p = ta.getAttribute("data-isectext").split(":");
        state.ing.questions[+p[0]].sections[+p[1]].text = ta.value;
      });
    });
    // 並べ替え・削除・追加：state を更新して再描画
    $all("[data-isecup]", root).forEach(function (b) {
      b.addEventListener("click", function () { readIngFromDom(); var p = b.getAttribute("data-isecup").split(":"); swap(state.ing.questions[+p[0]].sections, +p[1], +p[1] - 1); renderIngest(); });
    });
    $all("[data-isecdown]", root).forEach(function (b) {
      b.addEventListener("click", function () { readIngFromDom(); var p = b.getAttribute("data-isecdown").split(":"); swap(state.ing.questions[+p[0]].sections, +p[1], +p[1] + 1); renderIngest(); });
    });
    $all("[data-isecdel]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        readIngFromDom();
        var p = b.getAttribute("data-isecdel").split(":");
        var q = state.ing.questions[+p[0]];
        q.sections.splice(+p[1], 1);
        if (!q.sections.length) q.sections.push({ type: "問題", text: "" });
        renderIngest();
      });
    });
    $all("[data-isecadd]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        readIngFromDom();
        var q = state.ing.questions[+b.getAttribute("data-isecadd")];
        q.sections.push({ type: nextIngType(q), text: "" });
        renderIngest();
      });
    });
    $all("[data-iqdel]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        readIngFromDom();
        state.ing.questions.splice(+b.getAttribute("data-iqdel"), 1);
        renderIngest();
      });
    });
    // 記法ボタン：テキストエリアへ挿入し state に反映（再描画なし）
    $all("[data-imk]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-imk").split(":");
        var ta = $('[data-isectext="' + p[0] + ":" + p[1] + '"]', root);
        if (!ta) return;
        insertMarkup(ta, MK_DEFS[+p[2]].b, MK_DEFS[+p[2]].a, MK_DEFS[+p[2]].ls);
        state.ing.questions[+p[0]].sections[+p[1]].text = ta.value;
      });
    });
    $all("[data-imkimg]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-imkimg").split(":");
        var ta = $('[data-isectext="' + p[0] + ":" + p[1] + '"]', root);
        if (!ta) return;
        pickImageInto(ta, function (val) { state.ing.questions[+p[0]].sections[+p[1]].text = val; });
      });
    });
    $all("[data-syntax]", root).forEach(function (b) { b.addEventListener("click", openSyntaxModal); });
    // セクション単位の見え方確認
    $all("[data-isecpv]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        readIngFromDom();
        var p = b.getAttribute("data-isecpv").split(":");
        var sec = state.ing.questions[+p[0]].sections[+p[1]];
        openPreview(sec.type, field(sec.type, SECTION_ICONS[sec.type] || "fa-file-lines", sec.text || "（未入力）"));
      });
    });
    if (el("ing-add-q")) el("ing-add-q").addEventListener("click", function () {
      readIngFromDom();
      var n = state.ing.questions.reduce(function (mx, q) { return Math.max(mx, Number(q.questionNumber) || 0); }, 0) + 1;
      state.ing.questions.push({ questionNumber: n, category: "", sections: [{ type: "問題", text: "" }] });
      renderIngest();
    });
    if (el("ing-preview-all")) el("ing-preview-all").addEventListener("click", previewIngestAll);
    if (el("ing-register")) el("ing-register").addEventListener("click", registerIngest);
  }

  // 解析結果の全大問をまとめてプレビュー
  function previewIngestAll() {
    readIngFromDom();
    if (!state.ing.questions.length) { toast("表示する大問がありません", "err"); return; }
    var body = "";
    state.ing.questions.forEach(function (q) {
      var fields = [];
      q.sections.forEach(function (sec) {
        if ((sec.text || "").trim()) fields.push(field(sec.type, SECTION_ICONS[sec.type] || "fa-file-lines", sec.text));
      });
      body += '<div class="exam-section" style="margin-bottom:18px">' +
        '<div class="exam-section-title" style="color:var(--blue)"><i class="fa-solid fa-hashtag"></i> 大問' + esc(q.questionNumber) + (q.category ? "（" + esc(q.category) + "）" : "") + "</div>" +
        (fields.length ? fields.join('<hr class="exam-hr exam-field-sep">') : '<div class="hint">（未入力）</div>') + "</div>";
    });
    var m = [state.ing.year, state.ing.universityName, state.ing.schedule].filter(Boolean).join(" ");
    openPreview(m || "解析結果プレビュー", body);
  }

  // セクション配列を保存用の {problemText, answerText, commentaryText} へ（問題登録と同じ規則）
  function ingSectionsToQuestion(q) {
    var problemLines = [];
    q.sections.forEach(function (sec) {
      var t = sec.text || "";
      if (sec.type !== "問題") problemLines.push("{{" + sec.type + "}}");
      if (t) problemLines.push(t);
    });
    var answer = [], commentary = [];
    q.sections.forEach(function (sec) {
      if (sec.type === "解答") answer.push(sec.text || "");
      else if (sec.type === "解説") commentary.push(sec.text || "");
    });
    return {
      questionNumber: Number(q.questionNumber) || 1,
      category: (q.category || "").trim(),
      problemText: problemLines.join("\n\n"),
      answerText: answer.join("\n\n"),
      commentaryText: commentary.join("\n\n")
    };
  }

  function registerIngest() {
    readIngFromDom();
    var uni = (state.ing.universityName || "").trim();
    var year = Number(state.ing.year);
    var sched = (state.ing.schedule || "").trim();
    if (!uni || !year || !sched) { toast("大学名・年度・方式を入力してください", "err"); return; }
    var questions = state.ing.questions.map(ingSectionsToQuestion);
    if (!questions.length) { toast("登録する大問がありません", "err"); return; }

    el("ing-register").disabled = true;
    Api.createExam({ universityName: uni, year: year, schedule: sched, questions: questions }).then(function () {
      toast("登録しました（" + questions.length + " 大問）", "ok");
      if (el("ing-register")) el("ing-register").disabled = false;
      loadServerConfig();
    }).catch(function (e) {
      toast(e.message, "err");
      if (el("ing-register")) el("ing-register").disabled = false;
    });
  }

  /* ================= タブ: 取り込み設定（追加プロンプト） ================= */
  var PROMPT_EXAMPLE =
    "- ①②③ は ((1))((2))((3)) に、a. b. c. は ((a))((b))((c)) に、ア イ ウ は ((ア))((イ))((ウ)) に変換する\n" +
    "- 空所 [[ ]] の中には英数字のみを入れる（[[(1)]] のように記号を入れない）\n" +
    "- 下線部などに付く小問番号 (1)(2) は空所にせず ~~(1)~~ で下付きにする\n" +
    "- 注釈・脚注は必ず ##語::訳## の語注記法を使う\n" +
    "- 全訳・全文和訳は省略せず「全訳」セクションに全文を含める";

  function wireIngestConfig() {
    if (!el("cfg-ingest-prompt-save")) return;
    el("cfg-ingest-prompt-save").addEventListener("click", function () {
      if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
      var v = el("cfg-ingest-prompt").value;
      el("ingest-prompt-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> 保存中…';
      Api.updateConfig({ ingest_prompt: v }).then(function () {
        state.config.ingest_prompt = v;
        extPromptLoaded = false;  // 外部LLM用プロンプトを次回再取得
        el("ingest-prompt-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> 保存しました</span>';
        toast("追加プロンプトを保存しました", "ok");
      }).catch(function (e) {
        el("ingest-prompt-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
        toast(e.message, "err");
      });
    });
    el("cfg-ingest-prompt-example").addEventListener("click", function () {
      var ta = el("cfg-ingest-prompt");
      ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, "") + "\n" + PROMPT_EXAMPLE : PROMPT_EXAMPLE;
      toast("推奨例を挿入しました（保存で確定）", "ok");
    });

    // 大学ごとの注意点：大学選択でその注意点を読み込み、保存で Worker(config) へ
    if (el("uni-note-select")) {
      el("uni-note-select").addEventListener("change", function () {
        var name = el("uni-note-select").value;
        el("uni-note-text").value = (state.config.university_notes && state.config.university_notes[name]) || "";
        el("uni-note-status").textContent = "";
      });
    }
    if (el("uni-note-save")) {
      el("uni-note-save").addEventListener("click", function () {
        if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
        var name = el("uni-note-select").value;
        if (!name) { toast("大学を選択してください", "err"); return; }
        var notes = Object.assign({}, state.config.university_notes || {});
        var v = el("uni-note-text").value;
        if (v.trim()) notes[name] = v; else delete notes[name];
        el("uni-note-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> 保存中…';
        Api.updateConfig({ university_notes: notes }).then(function () {
          state.config.university_notes = notes;
          extPromptLoaded = false;  // 外部LLM用プロンプトを次回再取得
          el("uni-note-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> 保存しました</span>';
          toast(name + " の注意点を保存しました", "ok");
        }).catch(function (e) {
          el("uni-note-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
          toast(e.message, "err");
        });
      });
    }
  }

  /* ================= タブ: 登録データ置換（grep replace） ================= */
  // よく使う置換ルールのテンプレート。プルダウンで選んで「テンプレを挿入」で追加。
  var BULK_TEMPLATES = [
    { name: "全角句読点を和文に（，→、 / ．→。）", rules: [
      { from: "，", to: "、", regex: false },
      { from: "．", to: "。", regex: false }
    ] },
    { name: "下付き番号を下線の前へ（__…__~~(n)~~ → ~~(n)~~__…__）", rules: [
      { from: "__([^_]+)__~~([(（][^~]*[)）])~~", to: "~~$2~~__$1__", regex: true }
    ] }
  ];
  function wireReplaceTab() {
    if (!el("bulk-add")) return;
    state.bulk = Store.getReplaceRules();
    // テンプレート選択肢を生成
    var sel = el("bulk-template");
    if (sel) {
      sel.innerHTML = BULK_TEMPLATES.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name) + "</option>"; }).join("");
    }
    el("bulk-add").addEventListener("click", function () { readBulkFromDom(); state.bulk.push({ from: "", to: "", regex: false }); renderBulkList(); });
    if (el("bulk-regex-help")) el("bulk-regex-help").addEventListener("click", openRegexHelp);
    el("bulk-tpl-add").addEventListener("click", function () {
      readBulkFromDom();
      var t = BULK_TEMPLATES[Number(el("bulk-template").value) || 0];
      if (!t) return;
      t.rules.forEach(function (r) { state.bulk.push({ from: r.from, to: r.to, regex: !!r.regex }); });
      renderBulkList();
      toast("テンプレートを挿入しました（" + t.rules.length + " 件）", "ok");
    });
    el("bulk-preview").addEventListener("click", function () { runBulk(true); });
    el("bulk-run").addEventListener("click", function () {
      if (!confirm("登録済みの全問題に置換を実行します。元に戻せません。よろしいですか？")) return;
      runBulk(false);
    });
  }
  function bulkRules() {
    readBulkFromDom();
    Store.setReplaceRules(state.bulk);
    return state.bulk.filter(function (r) { return r.from; });
  }
  function runBulk(dryRun) {
    if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
    var rules = bulkRules();
    if (!rules.length) { toast("置換ルールを入力してください", "err"); return; }
    el("bulk-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> ' + (dryRun ? "確認中…" : "置換中…");
    Api.replaceRegistered(rules, dryRun).then(function (d) {
      if (dryRun) {
        el("bulk-status").innerHTML = '<span style="color:var(--blue-dark,#1d4ed8)"><i class="fa-solid fa-magnifying-glass"></i> ' +
          (d.changedRows || 0) + " 大問・" + (d.occurrences || 0) + " 箇所が対象（全 " + (d.total || 0) + " 大問）</span>";
      } else {
        el("bulk-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> ' +
          (d.changedRows || 0) + " 大問・" + (d.occurrences || 0) + " 箇所を置換しました</span>";
        toast("置換しました（" + (d.occurrences || 0) + " 箇所）", "ok");
      }
    }).catch(function (e) {
      el("bulk-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
      toast(e.message, "err");
    });
  }
  function readBulkFromDom() {
    var c = el("bulk-list");
    if (!c) return;
    var rows = $all("[data-bulk]", c);
    if (!rows.length) return;
    state.bulk = rows.map(function (row) {
      return { from: $(".bulk-from", row).value, to: $(".bulk-to", row).value, regex: $(".bulk-regex", row).checked };
    });
  }
  function renderBulkList() {
    var c = el("bulk-list");
    if (!c) return;
    if (!state.bulk.length) {
      c.innerHTML = '<p class="hint">まだルールがありません。「ルールを追加」または「推奨例を挿入」から作成してください。</p>';
      return;
    }
    var h = "";
    state.bulk.forEach(function (r, i) {
      h += '<div class="sort-item" data-bulk="' + i + '" style="gap:8px;flex-wrap:wrap">' +
        '<input type="text" class="bulk-from" placeholder="検索（例: ，）" value="' + esc(r.from || "") + '" style="flex:1;min-width:120px">' +
        '<i class="fa-solid fa-arrow-right" style="color:var(--blue)"></i>' +
        '<input type="text" class="bulk-to" placeholder="置換後（例: 、）" value="' + esc(r.to || "") + '" style="flex:1;min-width:120px">' +
        '<label class="check-inline" style="white-space:nowrap"><input type="checkbox" class="bulk-regex"' + (r.regex ? " checked" : "") + '> <span>正規表現</span></label>' +
        '<span class="move">' +
        '<button class="icon-btn sm" data-bulkup="' + i + '" title="上へ"' + (i === 0 ? " disabled" : "") + '><i class="fa-solid fa-arrow-up"></i></button>' +
        '<button class="icon-btn sm" data-bulkdown="' + i + '" title="下へ"' + (i === state.bulk.length - 1 ? " disabled" : "") + '><i class="fa-solid fa-arrow-down"></i></button>' +
        '<button class="icon-btn sm danger" data-bulkdel="' + i + '" title="削除"><i class="fa-solid fa-trash"></i></button>' +
        "</span></div>";
    });
    c.innerHTML = h;
    $all("[data-bulkup]", c).forEach(function (b) {
      b.addEventListener("click", function () { readBulkFromDom(); var i = +b.getAttribute("data-bulkup"); swap(state.bulk, i, i - 1); renderBulkList(); });
    });
    $all("[data-bulkdown]", c).forEach(function (b) {
      b.addEventListener("click", function () { readBulkFromDom(); var i = +b.getAttribute("data-bulkdown"); swap(state.bulk, i, i + 1); renderBulkList(); });
    });
    $all("[data-bulkdel]", c).forEach(function (b) {
      b.addEventListener("click", function () { readBulkFromDom(); state.bulk.splice(+b.getAttribute("data-bulkdel"), 1); renderBulkList(); });
    });
  }

  /* ================= タブ: 外部LLM取り込み ================= */
  var extPromptLoaded = false;
  function wireExtLlm() {
    if (!el("ext-load")) return;
    el("ext-copy").addEventListener("click", function () {
      var ta = el("ext-prompt");
      if (!ta.value) { toast("プロンプトがまだ読み込まれていません", "err"); return; }
      navigator.clipboard.writeText(ta.value).then(function () {
        toast("プロンプトをコピーしました", "ok");
      }, function () {
        // フォールバック（execCommand）
        ta.removeAttribute("readonly"); ta.select();
        try { document.execCommand("copy"); toast("プロンプトをコピーしました", "ok"); }
        catch (e) { toast("コピーに失敗しました。手動で選択してください", "err"); }
        ta.setAttribute("readonly", "readonly");
        window.getSelection && window.getSelection().removeAllRanges();
      });
    });
    el("ext-clear").addEventListener("click", function () { el("ext-json").value = ""; el("ext-status").innerHTML = ""; });
    el("ext-load").addEventListener("click", loadExtJson);
    // クリップボードから貼り付け欄へ転写
    if (el("ext-paste-btn")) el("ext-paste-btn").addEventListener("click", pasteExtJson);
    // ファイル選択（.json / .txt）で読み込み
    if (el("ext-file") && el("ext-file-btn")) {
      el("ext-file-btn").addEventListener("click", function () { el("ext-file").click(); });
      el("ext-file").addEventListener("change", function () {
        var f = this.files && this.files[0];
        if (f) readExtFile(f);
        this.value = "";  // 同じファイルを連続で選べるようにリセット
      });
    }
    // textarea へのドラッグ＆ドロップで読み込み
    var dz = el("ext-json");
    if (dz) {
      ["dragenter", "dragover"].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add("dragover"); });
      });
      ["dragleave", "dragend", "drop"].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove("dragover"); });
      });
      dz.addEventListener("drop", function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) readExtFile(f);
      });
    }
    // 大学選択でプロンプトを取り直し（その大学の注意点を反映）
    if (el("ext-uni-select")) {
      el("ext-uni-select").addEventListener("change", function () { loadExtPrompt(true); });
    }
  }
  // ボタンでの自動読み取りが使えないとき、欄にフォーカスして手動貼り付けを促す
  function focusExtJsonForManualPaste(msg) {
    var ta = el("ext-json");
    if (ta) { ta.focus(); }
    toast(msg + "。貼り付け欄をクリックして Ctrl+V（Macは Cmd+V）で貼り付けてください", "err");
  }
  // クリップボードの内容を貼り付け欄へ転写して読み込む
  // 対応状況はブラウザにより異なる: Chrome/Edge/Safari は対応（要権限）、
  // Firefox は Web ページからのクリップボード読み取りを仕様上サポートしない。
  // 非対応・拒否時は自動で「手動貼り付け」に切り替える。
  function pasteExtJson() {
    if (!window.isSecureContext) {
      focusExtJsonForManualPaste("HTTPS 接続でのみクリップボード読み取りが使えます");
      return;
    }
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      focusExtJsonForManualPaste("このブラウザ（Firefox 等）はボタンでの自動貼り付けに対応していません");
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      if (!text || !text.trim()) { toast("クリップボードが空です", "err"); return; }
      el("ext-json").value = text;
      el("ext-status").innerHTML = '<span class="hint"><i class="fa-solid fa-paste"></i> クリップボードから貼り付けました</span>';
      loadExtJson();
    }, function (err) {
      var name = err && err.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        focusExtJsonForManualPaste("クリップボードへのアクセスが許可されていません");
      } else {
        focusExtJsonForManualPaste("クリップボードの読み取りに失敗しました");
      }
    });
  }
  // .json / .txt ファイルをテキストとして読み、貼り付け欄に入れて読み込む
  function readExtFile(file) {
    var name = String(file.name || "").toLowerCase();
    if (!/\.(json|txt)$/.test(name) && file.type && !/json|text/.test(file.type)) {
      toast(".json または .txt ファイルを選んでください", "err");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      el("ext-json").value = String(reader.result || "");
      el("ext-status").innerHTML = '<span class="hint"><i class="fa-solid fa-file-import"></i> ' + esc(file.name) + " を読み込みました</span>";
      loadExtJson();
    };
    reader.onerror = function () { toast("ファイルの読み込みに失敗しました", "err"); };
    reader.readAsText(file);
  }
  // 外部LLM用プロンプトを Worker から取得して表示（初回のみ）
  function loadExtPrompt(force) {
    if (!el("ext-prompt")) return;
    if (extPromptLoaded && !force) return;
    if (!Store.getWorkerUrl()) {
      el("ext-prompt-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> Worker URL が未設定です（接続設定タブ）。</span>';
      return;
    }
    var uni = el("ext-uni-select") ? el("ext-uni-select").value : "";
    el("ext-prompt").value = "";
    el("ext-prompt").placeholder = "読み込み中…";
    el("ext-prompt-status").textContent = "";
    Api.getIngestPrompt(uni).then(function (d) {
      el("ext-prompt").value = (d && d.prompt) || "";
      extPromptLoaded = true;
      if (el("ext-uni-status")) {
        el("ext-uni-status").innerHTML = uni
          ? '<i class="fa-solid fa-circle-check"></i> ' + esc(uni) + ' を選択中（注意点が登録されていればプロンプトに反映されます）。'
          : "";
      }
    }).catch(function (e) {
      el("ext-prompt-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
    });
  }
  // 貼り付けJSON文字列から最初の { 〜 マッチする } を取り出す（コードフェンス等を許容）
  function extractJson(raw) {
    var s = String(raw || "").trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) s = fence[1].trim();
    // スマートクォートを ASCII クォートに正規化（LLMが " " などを出力するケース）
    s = s.replace(/[""]/g, '"').replace(/['']/g, "'");
    var i = s.indexOf("{");
    if (i < 0) return "";
    // 最初の { からカウントして、マッチする } を見つける
    var depth = 0, inStr = false, esc = false, j;
    for (j = i; j < s.length; j++) {
      var c = s[j];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) return s.slice(i, j + 1);
        }
      }
    }
    return "";  // マッチする } が見つからない
  }
  // コードフェンスを除去し、スマートクォートを正規化し、最初の { 〜 最後の } を広めに切り出す（修復前処理用）
  function sliceJson(raw) {
    var s = String(raw || "").trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) s = fence[1].trim();
    // LLMが出力するスマートクォート（U+201C/D, U+2018/9）を ASCII クォートに正規化
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    var i = s.indexOf("{"), j = s.lastIndexOf("}");
    if (i < 0 || j < i) return "";
    return s.slice(i, j + 1);
  }
  // LLM出力にありがちな壊れたJSONを修復する：
  //  ・文字列値内の未エスケープ二重引用符（英文中の "…" など）を \" に
  //  ・文字列内の生の改行・タブを \n \t に
  //  ・} ] 直前の末尾カンマを除去
  function repairJson(s) {
    var out = "", inStr = false, esc = false, ws = " \t\n\r";
    function nextNonWs(from) {
      var k = from;
      while (k < s.length && ws.indexOf(s[k]) >= 0) k++;
      return s[k];
    }
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (esc) { out += c; esc = false; continue; }
      if (c === "\\") { out += c; esc = true; continue; }
      if (inStr) {
        if (c === '"') {
          // 文字列の本当の終端か、本文中の引用符かを次の非空白文字で判定
          var nc = nextNonWs(i + 1);
          if (nc === undefined || nc === "," || nc === "}" || nc === "]" || nc === ":") {
            inStr = false; out += c;
          } else {
            out += '\\"';  // 本文中の引用符 → エスケープ
          }
        } else if (c === "\n") { out += "\\n"; }
        else if (c === "\r") { out += "\\r"; }
        else if (c === "\t") { out += "\\t"; }
        else { out += c; }
      } else {
        if (c === '"') { inStr = true; out += c; }
        else if (c === ",") {
          var nc2 = nextNonWs(i + 1);
          if (nc2 === "}" || nc2 === "]") { /* 末尾カンマを除去 */ }
          else out += c;
        }
        else { out += c; }
      }
    }
    return out;
  }
  function loadExtJson() {
    var raw = el("ext-json").value;
    if (!raw.trim()) { toast("JSONを貼り付けてください", "err"); return; }
    var extracted = extractJson(raw);
    var parsed, lastErr;
    try { parsed = JSON.parse(extracted); }
    catch (e) {
      lastErr = e;
      // 修復を試みる（未エスケープ引用符・制御文字・末尾カンマ）
      var repaired = repairJson(sliceJson(raw));
      try { parsed = JSON.parse(repaired); lastErr = null; }
      catch (e2) { lastErr = e2; }
    }
    if (lastErr) {
      var msg = lastErr.message || "不明なエラー";
      var detail = extracted ? "（抽出: " + extracted.slice(0, 60) + (extracted.length > 60 ? "..." : "") + "）" : "（JSON部分が見つかりません）";
      el("ext-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> JSONを読み取れませんでした: ' + esc(msg) + detail + '</span>';
      toast("JSONの解析に失敗しました", "err");
      return;
    }
    if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) {
      el("ext-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> questions 配列が見つかりません。</span>';
      toast("questions が見つかりません", "err");
      return;
    }
    // PDF取り込みと同じ編集画面へ
    renderIngestResult(parsed);
    el("ext-status").innerHTML = '<span style="color:var(--emerald-dark)"><i class="fa-solid fa-circle-check"></i> ' + parsed.questions.length + " 大問を読み込みました</span>";
    UI.setActiveTab(el("set-tabs"), "ingest");
    Store.setLastTab("setting", "ingest");
    toast("編集画面に読み込みました（PDF取り込みタブ）", "ok");
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
      if (!Array.isArray(state.config.section_types)) state.config.section_types = ["問題", "本文", "設問", "解答", "解説", "全訳"];
      Store.setSectionTypes(state.config.section_types);
      // 取り込み設定（追加プロンプト）を反映
      if (el("cfg-ingest-prompt")) el("cfg-ingest-prompt").value = state.config.ingest_prompt || "";
      if (!state.config.university_notes || typeof state.config.university_notes !== "object") state.config.university_notes = {};
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
      // 大学ごとの注意点 / 外部LLM用 大学選択プルダウン（よみがな＝五十音順）
      var uniNames = state.universities.slice().sort(function (a, b) {
        return (a.reading || a.name).localeCompare(b.reading || b.name, "ja") || a.name.localeCompare(b.name, "ja");
      }).map(function (u) { return u.name; });
      fillSelect(el("uni-note-select"), uniNames, "— 大学を選択 —");
      fillSelect(el("ext-uni-select"), uniNames, "— 指定なし —");
      if (el("uni-note-select") && el("uni-note-text")) {
        el("uni-note-text").value = state.config.university_notes[el("uni-note-select").value] || "";
      }
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
    // モーダル下部：この問題のみ置換
    el("exam-replace").addEventListener("click", toggleReplaceBar);
    if (el("exam-regex-help")) el("exam-regex-help").addEventListener("click", openRegexHelp);
    el("exam-rep-apply").addEventListener("click", applyExamReplace);
    el("exam-rep-to").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyExamReplace(); } });
    // モーダル下部：編集・削除（表示中の大問が対象）
    el("exam-edit").addEventListener("click", function () {
      var nav = state.list.nav;
      if (nav.examId == null) return;
      UI.closeModal(el("exam-modal"));
      loadExamIntoForm(nav.examId, nav.qnum != null ? nav.qnum : undefined);
    });
    el("exam-del").addEventListener("click", function () {
      var nav = state.list.nav;
      if (nav.examId == null) return;
      var qnum = nav.qnum;
      if (!confirm(qnum != null ? "この大問を削除しますか？" : "この入試問題（全大問）を削除しますか？")) return;
      var p = qnum != null ? Api.deleteQuestion(nav.examId, qnum) : Api.deleteExam(nav.examId);
      p.then(function () { toast("削除しました", "ok"); UI.closeModal(el("exam-modal")); loadList(); })
        .catch(function (e) { toast(e.message, "err"); });
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
          question_number: r.question_number, label: r.label || "", category: r.category || "",
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
  function schedOrderS(s) {
    var cfg = (state.config && state.config.schedules) || [];
    var i = cfg.indexOf(s);
    return i < 0 ? 999 : i;
  }
  function treeRowS(lvl, icon, label) {
    return '<button type="button" class="tree-row tree-row-' + lvl + '">' +
      '<i class="fa-solid fa-chevron-right tree-chev"></i>' +
      '<i class="fa-solid ' + icon + ' tree-ic"></i>' +
      '<span class="tree-label">' + label + "</span></button>";
  }
  // 一覧をツリー表示（大学→年度→方式→大問）。大問クリックで表示モーダル。
  function renderListTable() {
    var rows = state.list.rows.slice();
    if (!rows.length) { el("list-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>該当する入試問題がありません。</div></div>'; return; }
    var unis = {};
    rows.forEach(function (r) {
      var u = r.university_name || "（大学名なし）";
      var y = String(r.year);
      var s = r.schedule || "（方式なし）";
      if (!unis[u]) unis[u] = {};
      if (!unis[u][y]) unis[u][y] = {};
      if (!unis[u][y][s]) unis[u][y][s] = [];
      unis[u][y][s].push(r);
    });
    var flat = [];  // ツリー表示順（モーダルの前/次ナビ用）
    var rdg = {}; (state.universities || []).forEach(function (u) { if (u && u.name) rdg[u.name] = u.reading || ""; });
    var html = '<div class="tree card">';
    Object.keys(unis).sort(function (a, b) { return (rdg[a] || a).localeCompare(rdg[b] || b, "ja") || a.localeCompare(b, "ja"); }).forEach(function (u) {
      html += '<div class="tree-node">' + treeRowS("uni", "fa-building-columns", esc(u)) + '<div class="tree-children" hidden>';
      Object.keys(unis[u]).sort(function (a, b) { return Number(b) - Number(a); }).forEach(function (y) {
        html += '<div class="tree-node">' + treeRowS("year", "fa-calendar-days", esc(y) + "年度") + '<div class="tree-children" hidden>';
        Object.keys(unis[u][y]).sort(function (a, b) { return (schedOrderS(a) - schedOrderS(b)) || a.localeCompare(b, "ja"); }).forEach(function (s) {
          var qrows = unis[u][y][s].slice().sort(function (a, b) { return (Number(a.question_number) || 0) - (Number(b.question_number) || 0); });
          html += '<div class="tree-node">' + treeRowS("sched", "fa-layer-group", esc(s)) + '<div class="tree-children" hidden>';
          qrows.forEach(function (r) {
            flat.push(r);
            html += '<button type="button" class="tree-row tree-row-q" data-eid="' + r.exam_id + '" data-q="' + esc(String(r.question_number)) + '">' +
              '<i class="fa-solid fa-file-lines tree-ic"></i>' +
              '<span class="tree-label">大問' + esc(qLabel(r)) +
              (r.category ? ' <span class="tree-cat">' + esc(r.category) + "</span>" : "") + "</span></button>";
          });
          html += "</div></div>";
        });
        html += "</div></div>";
      });
      html += "</div></div>";
    });
    html += "</div>";
    state.list.sortedRows = flat;
    el("list-area").innerHTML = html;
    $all(".tree-row", el("list-area")).forEach(function (row) {
      row.addEventListener("click", function () {
        if (row.classList.contains("tree-row-q")) {
          openExam(Number(row.getAttribute("data-eid")), Number(row.getAttribute("data-q")));
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
    state.examView = null;
    hideReplaceBar();
    updateListExamNav();
    UI.openModal(el("exam-modal"));
    if (el("exam-shortcuts")) { el("exam-shortcuts").hidden = true; el("exam-shortcuts").innerHTML = ""; }
    el("exam-modal-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      var title = ex.year + "年 " + ex.university_name + " " + ex.schedule;
      var questions = ex.questions || [];
      if (qnum != null) {
        var titleQ = questions.filter(function (q) { return q.question_number === qnum; })[0];
        title += " 大問" + qLabel(titleQ || { question_number: qnum });
        questions = questions.filter(function (q) { return q.question_number === qnum; });
      }
      // 「この問題のみ置換」用に表示中の大問データを保持
      state.examView = { examId: examId, qnum: qnum, questions: questions };
      el("exam-modal-title").textContent = title;

      // 本文があり難易度帯の基準（四分位）が未取得なら、コーパスを取り込んでから描画
      var hasBody = questions.some(function (q) {
        return Markup.parseSections(q.problem_text || "").some(function (s) { return s.type === "本文"; });
      });
      var render = function () {
        if (hasBody) ensureLongLevels();
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
        buildExamShortcuts();
      };
      if (hasBody && !state.longLevel) {
        (state.corpus ? Promise.resolve() : Api.getCorpus().then(function (d) { state.corpus = d.questions || []; }, function () {}))
          .then(render, render);
      } else {
        render();
      }
    }).catch(function (e) { el("exam-modal-body").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
  }

  // モーダル下部に各セクションへの横スクロール式ショートカットを生成
  function buildExamShortcuts() {
    var bar = el("exam-shortcuts");
    if (!bar) return;
    var body = el("exam-modal-body");
    var items = $all(".exam-section-title", body);
    if (items.length < 2) { bar.hidden = true; bar.innerHTML = ""; return; }
    var html = "";
    items.forEach(function (node, i) {
      node.setAttribute("data-anchor", "a" + i);
      var label = node.textContent.trim();
      if (!label) return;
      html += '<button type="button" class="sc-btn" data-scroll="a' + i + '">' + esc(label) + "</button>";
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

  /* ---- 閲覧中の大問のみテキスト置換 ---- */
  function hideReplaceBar() {
    var bar = el("exam-replace-bar");
    if (bar) bar.hidden = true;
    if (el("exam-rep-from")) el("exam-rep-from").value = "";
    if (el("exam-rep-to")) el("exam-rep-to").value = "";
    if (el("exam-rep-regex")) el("exam-rep-regex").checked = false;
  }
  function toggleReplaceBar() {
    var bar = el("exam-replace-bar");
    if (!bar) return;
    bar.hidden = !bar.hidden;
    if (!bar.hidden) el("exam-rep-from").focus();
  }
  // 全置換し件数も返す。re を渡せば正規表現、無ければ from をリテラルとして扱う。
  function replaceCount(text, from, to, re) {
    var s = String(text == null ? "" : text);
    if (re) {
      var m = s.match(re);
      return { text: s.replace(re, to), count: m ? m.length : 0 };
    }
    if (!from) return { text: s, count: 0 };
    var parts = s.split(from);
    return { text: parts.join(to), count: parts.length - 1 };
  }
  function applyExamReplace() {
    var view = state.examView;
    if (!view || !view.questions || !view.questions.length) { toast("対象の問題がありません", "err"); return; }
    var from = el("exam-rep-from").value;
    var to = el("exam-rep-to").value;
    if (!from) { toast("検索（from）を入力してください", "err"); return; }
    var useRegex = el("exam-rep-regex") && el("exam-rep-regex").checked;
    var re = null;
    if (useRegex) {
      try { re = new RegExp(from, "g"); }
      catch (e) { toast("正規表現が不正です: " + (e.message || ""), "err"); return; }
    }

    var total = 0;
    var payload = view.questions.map(function (q) {
      var p = replaceCount(q.problem_text, from, to, re);
      var a = replaceCount(q.answer_text, from, to, re);
      var c = replaceCount(q.commentary_text, from, to, re);
      total += p.count + a.count + c.count;
      return {
        questionNumber: q.question_number,
        label: q.label || "",
        category: q.category || "",
        problemText: p.text, answerText: a.text, commentaryText: c.text
      };
    });
    if (!total) { toast("「" + from + "」は見つかりませんでした", "err"); return; }
    if (!confirm("この問題内の「" + from + "」を「" + to + "」に置換します（" + total + " 箇所）。よろしいですか？")) return;

    var btn = el("exam-rep-apply");
    btn.disabled = true;
    Api.updateExam(view.examId, { questions: payload }).then(function () {
      toast(total + " 箇所を置換しました", "ok");
      openExam(view.examId, view.qnum);  // 再取得して表示更新
    }).catch(function (e) {
      toast(e.message || "置換に失敗しました", "err");
    }).then(function () { btn.disabled = false; });
  }

  function isBodySection(label) { return label === "本文" || /全訳|和訳|訳/.test(label); }
  // 英単語数は共有モジュール Difficulty を使用
  function wordCount(text) { return Difficulty.wordCount(text); }
  // 長文レベルをコーパス単位でキャッシュ（重み変更・コーパス差し替えで再計算）
  function ensureLongLevels() {
    var w = Difficulty.weights();
    if (state.longLevel && state.longLevel.src === state.corpus && state.longLevel.wv === w.vocab) return state.longLevel;
    var r = Difficulty.corpusLevels(state.corpus || [], w);
    state.longLevel = { src: state.corpus, wv: w.vocab, byKey: r.byKey, cutoffs: r.cutoffs };
    return state.longLevel;
  }
  function markupOpts(label) {
    var body = isBodySection(label);
    return { paraNum: body, zenyaku: label === "全訳" };
  }
  function field(label, icon, text) {
    var body = isBodySection(label);
    var wc = "";
    if (label === "本文") {
      var score = Difficulty.scoreForText(text);
      var band = Difficulty.band(score, state.longLevel ? state.longLevel.cutoffs : null);
      wc = '<div class="word-count">(' + wordCount(text) + " words)" +
        (score ? ' <span class="level-inline" title="難易度（合成スコア）">' + esc(score.toFixed(1)) + " " + esc(band) + "</span>" : "") +
        "</div>";
    }
    return '<div style="margin-bottom:14px"><div class="exam-section-title">' + esc(label) +
      '</div><div class="exam-doc' + (body ? "" : " no-indent") + '">' + Markup.render(text, markupOpts(label)).html + wc + "</div></div>";
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
    if (el("reg-label-batch")) el("reg-label-batch").addEventListener("click", openLabelBatch);
    if (el("lb-save")) el("lb-save").addEventListener("click", saveLabelBatch);
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
    ["reg-year", "reg-university", "reg-schedule", "reg-qnum", "reg-label", "reg-category"].forEach(function (id) {
      if (!el(id)) return;
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
  function defaultMeta() { return { year: "", university: "", schedule: "", qnum: "1", label: "", category: "" }; }
  function readMetaFromDom() {
    return {
      year: el("reg-year").value, university: el("reg-university").value,
      schedule: el("reg-schedule").value, qnum: el("reg-qnum").value,
      label: el("reg-label") ? el("reg-label").value : "", category: el("reg-category").value
    };
  }
  function applyMetaToDom() {
    var m = state.reg.meta || defaultMeta();
    el("reg-year").value = m.year || "";
    el("reg-university").value = m.university || "";
    el("reg-schedule").value = m.schedule || "";
    el("reg-qnum").value = m.qnum || "1";
    if (el("reg-label")) el("reg-label").value = m.label || "";
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
    { l: "問",   t: "見出しバッジ {{ }}",       b: "{{", a: "}}" },
    { l: "空所", t: "空所 [[1]]",              b: "[[", a: "]]" },
    { l: "広空所", t: "3倍幅の空欄 [[-- --]]",   b: "[[-- --]]", a: "" },
    { l: "選択", t: "選択肢 ((A)) 本文",        b: "((", a: "))" },
    { l: "蛍光", t: "ハイライト ==語==",        b: "==", a: "==" },
    { l: "色",   t: "色付きハイライト ==語==:色", b: "==", a: "==:yellow" },
    { l: "下線", t: "下線 __語__",              b: "__", a: "__" },
    { l: "太字", t: "太字 **語**",              b: "**", a: "**" },
    { l: "語注", t: "語注 ##語::訳##",          b: "##", a: "::訳##" },
    { l: "段落", t: "段落番号 [1]（本文・和訳の段落先頭に置く）", b: "[", a: "]", ls: true },
    { l: "斜",   t: "斜字 ||||語||||",          b: "||||", a: "||||" },
    { l: "出典", t: "出典 !!!!出典!!!!（右寄せ・グレー）", b: "!!!!", a: "!!!!" },
    { l: "下付", t: "下付き ~~x~~",             b: "~~", a: "~~" },
    { l: "上付", t: "上付き ^^x^^",             b: "^^", a: "^^" },
    { l: "詰め", t: "字下げなし @@ （段落先頭のインデント抑制）", b: "@@", a: "" },
    { l: "区切", t: "区切り線 ----",            b: "\n----\n", a: "" },
    { l: "表",   t: "表（Markdown記法。| でセル区切り）", b: "\n| 見出し1 | 見出し2 |\n| --- | --- |\n| 　 | 　 |\n| 　 | 　 |\n", a: "" }
  ];
  function markupBar(i) {
    var h = '<div class="markup-bar">';
    MK_DEFS.forEach(function (bn, k) {
      h += '<button class="btn sm" data-mk="' + i + ":" + k + '" title="' + esc(bn.t) + '">' + esc(bn.l) + "</button>";
    });
    h += '<button class="btn sm" data-mkimg="' + i + '" title="画像を挿入（アップロード）"><i class="fa-solid fa-image"></i> 画像</button>';
    h += '<button class="btn sm link" data-syntax="1" title="記法の一覧と見え方"><i class="fa-solid fa-circle-question"></i> 記法一覧</button>';
    h += "</div>";
    return h;
  }
  // 画像ファイルを選択→R2へアップロード→記法 ![図](/api/image/..) を ta に挿入
  function pickImageInto(ta, onDone) {
    if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      toast("画像をアップロード中…", "ok");
      Api.uploadImage(f).then(function (r) {
        insertMarkup(ta, "![図](" + r.path + ")", "");
        if (onDone) onDone(ta.value);
        toast("画像を挿入しました", "ok");
      }).catch(function (e) { toast(e.message || "アップロードに失敗しました", "err"); });
    });
    inp.click();
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
        insertMarkup(ta, MK_DEFS[k].b, MK_DEFS[k].a, MK_DEFS[k].ls);
        state.reg.sections[i].text = ta.value;
        saveDraft();
      });
    });
    $all("[data-mkimg]", c).forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-mkimg"));
        var ta = $('[data-sectext="' + i + '"]', c);
        pickImageInto(ta, function (val) { state.reg.sections[i].text = val; saveDraft(); });
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
    { code: "Write here: [[-- --]] / [[--A--]]", desc: "3倍幅の空欄（ダッシュで囲む。囲んだ中身はラベル表示）" },
    { code: "The ##immune::免疫## system.", desc: "語注（末尾に訳一覧）" },
    { code: "##M^isdiagnosis::誤診##", desc: "語注の ^ は注のみ直前文字を小文字化（本文Misdiagnosis／注misdiagnosis）" },
    { code: "[1] In the first paragraph...\n\n[2] The second paragraph follows.", desc: "段落番号（本文・和訳の段落先頭に [1] [2]。空所 [[ ]] とは別）", body: true },
    { code: "He felt ||||déjà vu||||.", desc: "斜字（イタリック）" },
    { code: "!!!!出典: The Economist (2023)!!!!", desc: "出典（右寄せ・グレー・小）" },
    { code: "This is ==important==.", desc: "ハイライト（黄）" },
    { code: "A ==keyword==:blue here.", desc: "色付きハイライト（yellow/blue/red/purple/pink/green/aqua）" },
    { code: "An __underlined__ word.", desc: "下線" },
    { code: "A **bold** word.", desc: "太字" },
    { code: "H~~2~~O and 1^^st^^.", desc: "下付き・上付き" },
    { code: "((A)) apple\n((B)) a very long choice that wraps neatly onto the next line", desc: "選択肢（行頭。折り返しも整形）" },
    { code: "----", desc: "区切り線" },
    { code: "@@The quick brown fox jumps.", desc: "@@ — 行頭に付けると段落インデントを抑制" },
    { code: "| 語 | 意味 |\n| --- | --- |\n| apple | りんご |\n| orange | オレンジ |", desc: "表（Markdown記法。1行目=見出し、2行目=区切り |---|、以降が中身。:--- 左 / :--: 中央 / ---: 右寄せ）" },
    { code: "![図](/api/image/sample.png)", desc: "画像（写真・グラフ）。記法ボタンの「画像」からアップロードすると自動挿入。外部URLも可: ![説明](https://...)" }
  ];
  function openSyntaxModal() {
    var h = "";
    SYNTAX_EXAMPLES.forEach(function (ex) {
      h += '<div style="margin-bottom:16px">' +
        '<div class="exam-section-title">' + esc(ex.desc) + "</div>" +
        '<pre style="margin:0 0 6px;background:var(--grad-chip);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:12.5px;white-space:pre-wrap;overflow-x:auto">' + esc(ex.code) + "</pre>" +
        '<div class="exam-doc" style="border:1px dashed var(--line);border-radius:8px;padding:8px 12px">' + Markup.render(ex.code, { paraNum: ex.body }).html + "</div>" +
      "</div>";
    });
    el("syntax-body").innerHTML = h;
    UI.openModal(el("syntax-modal"));
  }

  /* ---- 正規表現 早見表モーダル ---- */
  // [パターン, 意味, 例]
  var REGEX_BASICS = [
    [".", "任意の1文字", "a.c → abc, a7c"],
    ["*", "直前を0回以上くり返し", "ab* → a, ab, abbb"],
    ["+", "直前を1回以上くり返し", "go+gle → gogle, google"],
    ["?", "直前が0または1回（任意）", "colou?r → color, colour"],
    ["\\d", "数字1文字（0-9）", "\\d+ → 2024"],
    ["\\D", "数字以外の1文字", ""],
    ["\\w", "英数字または _ の1文字", ""],
    ["\\s", "空白文字（スペース・タブ・改行）", "\\s+ → 連続する空白"],
    ["[ABC]", "かっこ内のいずれか1文字", "[abc] → a か b か c"],
    ["[A-Z]", "範囲指定の1文字", "[0-9] 数字 / [ぁ-ん] ひらがな"],
    ["[^ABC]", "かっこ内『以外』の1文字", ""],
    ["^ / $", "文字列の先頭 / 末尾", "※行ごとではなく全体の先頭・末尾"],
    ["( )", "グループ化＋キャプチャ", "置換側で $1 として使える"],
    ["|", "または（OR）", "前期|後期 → 前期 か 後期"],
    ["{n} {n,} {n,m}", "回数の指定", "\\d{4} → 数字ちょうど4桁"],
    ["\\", "記号をただの文字に（エスケープ）", "\\. は『.』 / \\( は『(』 / \\| は『|』"],
  ];
  // [検索(from), 置換(to), 説明]
  var REGEX_EXAMPLES = [
    ["\\s+", "（半角スペース1つ）", "連続する空白を1つにまとめる"],
    ["，", "、", "全角カンマを読点に（リテラルでも可）"],
    ["(\\d+)年", "$1", "『2024年』→『2024』（「年」を消す）"],
    ["（[^）]*）", "（空欄）", "全角かっこの注記をまるごと削除"],
    ["__([^_]+)__~~(\\([^~]*\\))~~", "~~$2~~__$1__", "下線の直後の下付き番号を前へ入れ替え"],
  ];
  function openRegexHelp() {
    function rows(arr, headers) {
      var h = '<table class="rx-table"><thead><tr>';
      headers.forEach(function (x) { h += "<th>" + esc(x) + "</th>"; });
      h += "</tr></thead><tbody>";
      arr.forEach(function (r) {
        h += "<tr><td><code>" + esc(r[0]) + "</code></td><td>" + esc(r[1]) + "</td>" +
             (r.length > 2 ? "<td>" + esc(r[2]) + "</td>" : "") + "</tr>";
      });
      return h + "</tbody></table>";
    }
    var body =
      '<p class="hint" style="margin-bottom:10px">「正規表現」をオンにしたときに使える書き方の早見表です。検索（from）にパターン、置換（to）で <code>$1</code> <code>$2</code>（グループの中身）を使えます。マッチは全体（フラグ g）で行われます。</p>' +
      '<div class="exam-section-title">基本パターン</div>' + rows(REGEX_BASICS, ["パターン", "意味", "例"]) +
      '<div class="exam-section-title" style="margin-top:16px">置換でよく使う例</div>' + rows(REGEX_EXAMPLES, ["検索 (from)", "置換 (to)", "説明"]) +
      '<p class="hint" style="margin-top:12px"><i class="fa-solid fa-triangle-exclamation"></i> 注意: <code>^</code> <code>$</code> は各行ではなく<strong>文字列全体</strong>の先頭・末尾に一致します。記号（<code>. ( ) [ ] | * + ? \\</code> など）をそのままの文字として探したいときは前に <code>\\</code> を付けてください（例: <code>\\.</code>）。</p>';
    el("regex-help-body").innerHTML = body;
    UI.openModal(el("regex-help-modal"));
  }

  function moveSection(i, delta) {
    var j = i + delta; if (j < 0 || j >= state.reg.sections.length) return;
    var tmp = state.reg.sections[i]; state.reg.sections[i] = state.reg.sections[j]; state.reg.sections[j] = tmp;
    renderReg();
    saveDraft();
  }
  // テキストエリアにマークアップ挿入。選択範囲を before/after で囲む。
  // 選択なしの場合は before|after の中央にカーソルを置く（例: 空所 [[ | ]]）。
  // lineStart=true のときは選択を無視し、カーソル行の行頭に before を挿入（例: ++ 段落マーカー）。
  function insertMarkup(ta, before, after, lineStart) {
    ta.focus();
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    if (lineStart) {
      var ls = v.lastIndexOf("\n", s - 1) + 1;  // カーソル行の行頭位置
      ta.value = v.slice(0, ls) + before + after + v.slice(ls);
      ta.selectionStart = ta.selectionEnd = ls + before.length;  // before と after の間にカーソル
      ta.focus();
      return;
    }
    var sel = v.slice(s, e);
    ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
    var caret = sel ? s + before.length + sel.length + after.length : s + before.length;
    ta.selectionStart = ta.selectionEnd = caret;
    ta.focus();
  }
  function collectReg() {
    var year = el("reg-year").value, uni = el("reg-university").value, sched = el("reg-schedule").value;
    var qnum = Number(el("reg-qnum").value) || 1;
    var label = el("reg-label") ? el("reg-label").value.trim() : "";
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
        questionNumber: qnum, label: label, category: category,
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
        qnum: String(q.question_number || 1), label: q.label || "", category: q.category || ""
      };
      UI.setActiveTab(el("set-tabs"), "register"); Store.setLastTab("setting", "register");
      renderReg();
      saveDraft();
      if (!silent) toast("編集モードで読み込みました", "ok");
    }).catch(function (e) { toast(e.message, "err"); });
  }

  /* ---- 大問ラベルの一括編集（選択中の大学・年度が対象） ---- */
  var labelBatch = { uni: "", year: "", exams: [] };
  function openLabelBatch() {
    var uni = el("reg-university").value, year = el("reg-year").value;
    if (!uni || !year) { toast("大学と年度を選択してください", "err"); return; }
    if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
    el("lb-title").textContent = "ラベル一括編集 — " + uni + " " + year + "年";
    el("lb-status").textContent = "";
    el("lb-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    labelBatch = { uni: uni, year: year, exams: [] };
    UI.openModal(el("label-batch-modal"));
    Api.getExams({ universityName: uni, year: year }).then(function (data) {
      // getExams は大学名を部分一致で返すため、完全一致だけに絞る
      var exams = (data.exams || []).filter(function (e) {
        return e.university_name === uni && String(e.year) === String(year);
      });
      if (!exams.length) {
        el("lb-body").innerHTML = '<div class="empty"><i class="fa-solid fa-inbox ic"></i>この大学・年度の登録がありません。</div>';
        return;
      }
      return Promise.all(exams.map(function (e) {
        return Api.getExam(e.id).then(function (d) { return d.exam; }).catch(function () { return null; });
      })).then(function (full) {
        labelBatch.exams = full.filter(Boolean);
        renderLabelBatch();
      });
    }).catch(function (e) {
      el("lb-body").innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div>";
    });
  }
  function renderLabelBatch() {
    var exams = labelBatch.exams.slice().sort(function (a, b) {
      return (schedOrderS(a.schedule) - schedOrderS(b.schedule)) || String(a.schedule).localeCompare(String(b.schedule), "ja");
    });
    var h = '<p class="hint" style="margin-bottom:12px"><i class="fa-solid fa-circle-info"></i> 各大問の表示ラベルをまとめて編集できます。空欄にすると「大問＋番号」に戻ります。並び順は番号のままで、ラベルは表示だけを上書きします。</p>';
    exams.forEach(function (ex) {
      var qs = (ex.questions || []).slice().sort(function (a, b) { return (Number(a.question_number) || 0) - (Number(b.question_number) || 0); });
      h += '<div style="margin-bottom:18px">' +
        '<div class="exam-section-title" style="color:var(--blue)"><i class="fa-solid fa-layer-group"></i> ' + esc(ex.schedule || "（方式なし）") + "</div>";
      if (!qs.length) { h += '<p class="hint">大問がありません。</p></div>'; return; }
      qs.forEach(function (q) {
        var snippet = Markup.strip ? Markup.strip(q.problem_text || "").replace(/\s+/g, " ").trim().slice(0, 44) : "";
        h += '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' +
          '<strong style="min-width:64px;white-space:nowrap">大問' + esc(String(q.question_number)) + "</strong>" +
          '<span class="hint" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            (q.category ? "（" + esc(q.category) + "）" : "") + (snippet ? " " + esc(snippet) : "") + "</span>" +
          '<input class="edit-item-input" type="text" data-lb="' + ex.id + ":" + q.question_number +
            '" value="' + esc(q.label || "") + '" placeholder="例: ' + esc(String(q.question_number)) + 'A" style="width:140px;flex:none" />' +
          "</div>";
      });
      h += "</div>";
    });
    el("lb-body").innerHTML = h;
  }
  function saveLabelBatch() {
    var inputs = $all("[data-lb]", el("lb-body"));
    if (!inputs.length) { UI.closeModal(el("label-batch-modal")); return; }
    var byExam = {};  // examId -> { question_number: 新ラベル }
    inputs.forEach(function (inp) {
      var parts = inp.getAttribute("data-lb").split(":");
      var eid = parts[0], qn = Number(parts[1]);
      if (!byExam[eid]) byExam[eid] = {};
      byExam[eid][qn] = inp.value.trim();
    });
    // 各 exam を full questions で PUT（本文等は保持し label のみ更新）
    var ops = labelBatch.exams.map(function (ex) {
      var map = byExam[ex.id] || {};
      var questions = (ex.questions || []).map(function (q) {
        return {
          questionNumber: q.question_number,
          label: (map[q.question_number] != null) ? map[q.question_number] : (q.label || ""),
          category: q.category || "",
          problemText: q.problem_text || "",
          answerText: q.answer_text || "",
          commentaryText: q.commentary_text || ""
        };
      });
      return Api.updateExam(ex.id, { questions: questions });
    });
    if (!ops.length) { UI.closeModal(el("label-batch-modal")); return; }
    var btn = el("lb-save"); btn.disabled = true;
    el("lb-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> 保存中…';
    Promise.all(ops).then(function () {
      el("lb-status").textContent = "";
      toast("ラベルを保存しました", "ok");
      UI.closeModal(el("label-batch-modal"));
      // 編集中の大問があればフォームのラベル欄も最新化
      if (state.reg.editingExamId) loadExamIntoForm(state.reg.editingExamId, state.reg.editingQuestionNumber, true);
    }).catch(function (e) {
      el("lb-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
      toast(e.message || "保存に失敗しました", "err");
    }).then(function () { btn.disabled = false; });
  }

  /* ---- 年度/方式/大学/種別 編集モーダル（汎用） ---- */
  function openEditModal(title, items, onSave, opts) {
    opts = opts || {};
    // editable=true のときは items を { id, name } オブジェクト配列として扱い、名前を直接編集可能にする。
    // withReading=true のときは「よみがな」欄も表示し、{ id, name, reading } を扱う。
    state.editCtx = { items: items.slice(), onSave: onSave, editable: !!opts.editable, withReading: !!opts.withReading };
    el("edit-modal-title").textContent = title;
    el("edit-new").value = "";
    renderEditList();
    UI.openModal(el("edit-modal"));
  }
  function renderEditList() {
    var items = state.editCtx.items, c = el("edit-list"), editable = state.editCtx.editable, withReading = state.editCtx.withReading;
    c.innerHTML = "";
    if (!items.length) c.innerHTML = '<li class="hint">項目がありません。上で追加してください。</li>';
    items.forEach(function (it, i) {
      var label;
      if (editable) {
        label = '<input class="edit-item-input" type="text" data-edit="' + i + '" value="' + esc(it.name) + '" placeholder="名称" />';
        if (withReading) label += '<input class="edit-item-input edit-item-reading" type="text" data-editr="' + i + '" value="' + esc(it.reading || "") + '" placeholder="よみがな（五十音順用・任意）" />';
      } else {
        label = '<span class="label">' + esc(it) + "</span>";
      }
      var li = create("li", { class: "sort-item" },
        label + "<span class='move'>" +
        '<button class="icon-btn sm" data-up="' + i + '"' + (i === 0 ? " disabled" : "") + '><i class="fa-solid fa-arrow-up"></i></button>' +
        '<button class="icon-btn sm" data-down="' + i + '"' + (i === items.length - 1 ? " disabled" : "") + '><i class="fa-solid fa-arrow-down"></i></button>' +
        '<button class="icon-btn sm danger" data-del="' + i + '"><i class="fa-solid fa-trash"></i></button></span>');
      c.appendChild(li);
    });
    $all("[data-up]", c).forEach(function (b) { b.addEventListener("click", function () { var i = +b.getAttribute("data-up"); swap(state.editCtx.items, i, i - 1); renderEditList(); }); });
    $all("[data-down]", c).forEach(function (b) { b.addEventListener("click", function () { var i = +b.getAttribute("data-down"); swap(state.editCtx.items, i, i + 1); renderEditList(); }); });
    $all("[data-del]", c).forEach(function (b) { b.addEventListener("click", function () { state.editCtx.items.splice(+b.getAttribute("data-del"), 1); renderEditList(); }); });
    $all("[data-edit]", c).forEach(function (inp) { inp.addEventListener("input", function () { state.editCtx.items[+inp.getAttribute("data-edit")].name = inp.value; }); });
    $all("[data-editr]", c).forEach(function (inp) { inp.addEventListener("input", function () { state.editCtx.items[+inp.getAttribute("data-editr")].reading = inp.value; }); });
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
    // 大学は API 由来。名前・よみがなは直接編集可能。更新・削除は API、追加はローカル保持（登録時に自動作成）。
    // よみがな（reading）は五十音順ソートに使う。
    var startItems = state.universities.map(function (u) { return { id: u.id, name: u.name, reading: u.reading || "" }; });
    openEditModal("大学名・よみがなの編集", startItems, function (items) {
      var existing = state.universities.filter(function (u) { return u.id != null; });
      var byId = {}; existing.forEach(function (u) { byId[u.id] = u; });
      var keptIds = {}, ops = [];
      // 更新: id があり 名前 or よみがな が変わったもの
      items.forEach(function (it) {
        if (it.id == null) return;
        keptIds[it.id] = true;
        var orig = byId[it.id], name = (it.name || "").trim(), reading = (it.reading || "").trim();
        if (orig && name && (name !== orig.name || reading !== (orig.reading || ""))) ops.push(Api.updateUniversity(it.id, name, reading));
      });
      // 削除: 元々あって items から消えた id（試験があるとAPI側で弾かれるので catch）
      existing.forEach(function (u) { if (!keptIds[u.id]) ops.push(Api.deleteUniversity(u.id).catch(function () {})); });
      return Promise.all(ops)
        .then(function () { return Api.getUniversities().catch(function () { return { universities: existing }; }); })
        .then(function (res) {
          state.universities = (res.universities || []).map(function (u) { return { id: u.id, name: u.name, reading: u.reading || "" }; });
          // 新規追加（id:null）のローカル名は登録時に作成されるため末尾に保持
          items.forEach(function (it) {
            var name = (it.name || "").trim();
            if (it.id == null && name && !state.universities.some(function (u) { return u.name === name; })) {
              state.universities.push({ id: null, name: name, reading: (it.reading || "").trim() });
            }
          });
          fillRegSelects();
          fillSelect(el("sm-university"), state.universities.map(function (u) { return u.name; }), "指定なし");
        });
    }, { editable: true, withReading: true });
  }

  /* ================= タブ: 大学のよみがな ================= */
  var uniYomiRows = [];  // [{ id, name, reading }]（編集中の値）
  function wireUniYomi() {
    if (el("uniyomi-save")) el("uniyomi-save").addEventListener("click", saveUniYomi);
    if (el("uniyomi-reload")) el("uniyomi-reload").addEventListener("click", loadUniYomi);
  }
  function loadUniYomi() {
    var box = el("uniyomi-list");
    if (!box) return;
    if (!Store.getWorkerUrl()) { box.innerHTML = noWorker(); return; }
    box.innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    Api.getUniversities().then(function (d) {
      var us = (d.universities || []).slice();
      us.sort(function (a, b) { return (a.reading || a.name).localeCompare(b.reading || b.name, "ja") || a.name.localeCompare(b.name, "ja"); });
      state.universities = us.map(function (u) { return { id: u.id, name: u.name, reading: u.reading || "", abbreviation: u.abbreviation || "" }; });
      uniYomiRows = state.universities.map(function (u) { return { id: u.id, name: u.name, reading: u.reading, abbreviation: u.abbreviation }; });
      renderUniYomi();
    }).catch(function (e) {
      box.innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div>";
    });
  }
  function renderUniYomi() {
    var box = el("uniyomi-list");
    if (!uniYomiRows.length) { box.innerHTML = '<p class="hint">登録された大学がありません。</p>'; return; }
    var h = '<ul class="sort-list">';
    uniYomiRows.forEach(function (u, i) {
      h += '<li class="sort-item uniyomi-item">' +
        '<span class="label">' + esc(u.name) + "</span>" +
        '<input class="edit-item-input edit-item-reading" type="text" data-yomi="' + i + '" value="' + esc(u.reading) + '" placeholder="よみがな（ひらがな）" />' +
        '<input class="edit-item-input edit-item-abbr" type="text" data-abbr="' + i + '" value="' + esc(u.abbreviation || "") + '" placeholder="略称（表示用・任意）" />' +
        "</li>";
    });
    box.innerHTML = h + "</ul>";
    $all("[data-yomi]", box).forEach(function (inp) {
      inp.addEventListener("input", function () { uniYomiRows[+inp.getAttribute("data-yomi")].reading = inp.value; });
    });
    $all("[data-abbr]", box).forEach(function (inp) {
      inp.addEventListener("input", function () { uniYomiRows[+inp.getAttribute("data-abbr")].abbreviation = inp.value; });
    });
  }
  function saveUniYomi() {
    if (!Store.getWorkerUrl()) { toast("Worker URL が未設定です（接続設定タブ）", "err"); return; }
    var orig = {}; (state.universities || []).forEach(function (u) { orig[u.id] = { reading: u.reading || "", abbreviation: u.abbreviation || "" }; });
    var ops = [];
    uniYomiRows.forEach(function (u) {
      if (u.id == null) return;
      var o = orig[u.id] || { reading: "", abbreviation: "" };
      var reading = (u.reading || "").trim(), abbr = (u.abbreviation || "").trim();
      if (reading !== o.reading || abbr !== o.abbreviation) {
        ops.push(Api.updateUniversity(u.id, u.name, reading, abbr));
      }
    });
    if (!ops.length) { toast("変更はありません", "ok"); return; }
    el("uniyomi-status").innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> 保存中…';
    Promise.all(ops).then(function () {
      el("uniyomi-status").textContent = "";
      toast(ops.length + " 件を保存しました", "ok");
      loadUniYomi();
    }).catch(function (e) {
      el("uniyomi-status").innerHTML = '<span style="color:#b91c1c"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.message) + "</span>";
      toast(e.message, "err");
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
      if (state.editCtx.editable) {
        if (!state.editCtx.items.some(function (it) { return it.name === v; })) state.editCtx.items.push({ id: null, name: v });
      } else if (state.editCtx.items.indexOf(v) < 0) {
        state.editCtx.items.push(v);
      }
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
