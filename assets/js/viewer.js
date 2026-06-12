/* =====================================================================
   viewer.js — 閲覧ページ (index.html) のロジック
   ===================================================================== */
(function () {
  "use strict";
  var el = UI.el, $ = UI.$, $all = UI.$all, create = UI.create, esc = UI.escapeHtml;

  var TAB_DEFS = {
    search: { id: "search", label: "通常検索", icon: "fa-table-list" },
    corpus: { id: "corpus", label: "コーパス検索", icon: "fa-language" }
  };
  var DEFAULT_ORDER = ["search", "corpus"];

  // 状態
  var state = {
    filter: { word: "", universityName: "", year: "", schedule: "", qnum: "" },
    rows: [],
    sort: { key: "year", dir: "desc" },
    config: null,
    corpus: null,        // 取得済み corpus questions
    charts: {}
  };

  /* ---------------- 初期化 ---------------- */
  function init() {
    // サイトタイトル
    var title = Store.getSiteTitle();
    el("site-title").textContent = title;
    el("page-title-text").textContent = title;
    document.title = title;

    // タブ構築
    var order = Store.getTabOrder("main", DEFAULT_ORDER);
    var active = Store.getLastTab("main");
    if (DEFAULT_ORDER.indexOf(active) < 0) active = order[0];
    UI.buildTabs({
      tabsEl: el("main-tabs"), order: order, defs: TAB_DEFS, active: active,
      onChange: function (id) { Store.setLastTab("main", id); if (id === "corpus") ensureCorpusControls(); }
    });
    UI.setActiveTab(el("main-tabs"), active);

    // モーダル配線
    UI.wireModal(el("search-modal"));
    UI.wireModal(el("exam-modal"));
    el("btn-open-search").addEventListener("click", openSearch);
    el("btn-open-search-2").addEventListener("click", openSearch);
    el("sm-run").addEventListener("click", runSearch);
    el("btn-clear-filter").addEventListener("click", clearFilter);
    el("btn-run-corpus").addEventListener("click", runCorpus);
    el("exam-print").addEventListener("click", function () { window.print(); });

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
    loadConfig().then(loadResults);
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
      // タイトルは Worker 側設定があれば優先（未保存ならローカル）
      if (cfg.site_title) {
        el("site-title").textContent = cfg.site_title;
        el("page-title-text").textContent = cfg.site_title;
        document.title = cfg.site_title;
      }
      fillSelect(el("sm-year"), cfg.year_presets || [], "指定なし");
      fillSelect(el("sm-schedule"), cfg.schedules || [], "指定なし");
      fillSelect(el("sm-university"), unis.map(function (u) { return u.name; }), "指定なし");
    });
  }

  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = '<option value="">' + esc(placeholder) + "</option>";
    items.forEach(function (it) {
      var o = create("option"); o.value = it; o.textContent = it; sel.appendChild(o);
    });
  }

  /* ---------------- 検索モーダル ---------------- */
  function openSearch() {
    el("sm-word").value = state.filter.word;
    el("sm-university").value = state.filter.universityName;
    el("sm-year").value = state.filter.year;
    el("sm-schedule").value = state.filter.schedule;
    el("sm-qnum").value = state.filter.qnum;
    UI.openModal(el("search-modal"));
  }
  function runSearch() {
    state.filter = {
      word: el("sm-word").value.trim(),
      universityName: el("sm-university").value,
      year: el("sm-year").value,
      schedule: el("sm-schedule").value,
      qnum: el("sm-qnum").value.trim()
    };
    UI.closeModal(el("search-modal"));
    UI.setActiveTab(el("main-tabs"), "search");
    Store.setLastTab("main", "search");
    loadResults();
  }
  function clearFilter() {
    state.filter = { word: "", universityName: "", year: "", schedule: "", qnum: "" };
    loadResults();
  }

  /* ---------------- 結果テーブル ---------------- */
  function loadResults() {
    if (!Store.getWorkerUrl()) { el("results-area").innerHTML = noWorkerHtml(); return; }
    updateFilterSummary();
    el("results-area").innerHTML = '<div class="card"><div class="loading-row"><span class="spinner"></span> 読み込み中…</div></div>';
    Api.search({
      word: state.filter.word, universityName: state.filter.universityName,
      year: state.filter.year, schedule: state.filter.schedule
    }).then(function (data) {
      var rows = (data.results || []).map(function (r) {
        return {
          exam_id: r.exam_id, university_name: r.university_name, year: r.year,
          schedule: r.schedule, question_count: r.question_count,
          matching: r.matching_questions || "", occurrences: r.total_occurrences || 0
        };
      });
      // 大問番号フィルタ（クライアント側）
      if (state.filter.qnum) {
        var qn = state.filter.qnum;
        rows = rows.filter(function (r) {
          var list = String(r.matching || "").split(",").map(function (s) { return s.trim(); });
          return list.indexOf(qn) >= 0 || r.question_count >= Number(qn);
        });
      }
      state.rows = rows;
      renderTable();
    }).catch(function (e) {
      el("results-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div></div>";
    });
  }

  function updateFilterSummary() {
    var f = state.filter, parts = [];
    if (f.word) parts.push('キーワード「' + f.word + '」');
    if (f.year) parts.push(f.year + "年");
    if (f.universityName) parts.push(f.universityName);
    if (f.schedule) parts.push(f.schedule);
    if (f.qnum) parts.push("大問" + f.qnum);
    el("filter-summary").textContent = parts.length ? parts.join(" / ") + " で絞り込み中" : "すべての入試問題を表示中";
  }

  function renderTable() {
    var rows = state.rows.slice();
    var key = state.sort.key, dir = state.sort.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === "year" || key === "question_count" || key === "occurrences") { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av || "").toLowerCase(); bv = String(bv || "").toLowerCase(); }
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });

    if (!rows.length) {
      el("results-area").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>該当する入試問題がありません。</div></div>';
      return;
    }

    var showOcc = !!state.filter.word;
    var cols = [
      { key: "year", label: "年度" },
      { key: "university_name", label: "大学名" },
      { key: "schedule", label: "方式" },
      { key: "question_count", label: "大問数" }
    ];
    if (showOcc) cols.push({ key: "occurrences", label: "出現回数" });

    var html = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) {
      var sorted = state.sort.key === c.key;
      var ic = sorted ? (state.sort.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort";
      html += '<th class="sortable' + (sorted ? " sorted" : "") + '" data-sort="' + c.key + '">' +
        esc(c.label) + '<i class="fa-solid ' + ic + ' sort-ic"></i></th>';
    });
    html += '<th style="text-align:right">表示</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += "<tr>" +
        '<td><span class="pill em">' + esc(r.year) + "</span></td>" +
        "<td><strong>" + esc(r.university_name) + "</strong></td>" +
        "<td>" + esc(r.schedule) + "</td>" +
        '<td>' + esc(r.question_count) + (r.matching ? ' <span class="hint">(' + esc(r.matching) + ")</span>" : "") + "</td>" +
        (showOcc ? '<td><span class="pill">' + esc(r.occurrences) + "</span></td>" : "") +
        '<td class="row-actions"><button class="icon-btn" data-view="' + r.exam_id + '" title="表示"><i class="fa-solid fa-eye"></i></button></td>' +
        "</tr>";
    });
    html += "</tbody></table></div>";
    el("results-area").innerHTML = html;

    $all("th.sortable", el("results-area")).forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-sort");
        if (state.sort.key === k) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else { state.sort.key = k; state.sort.dir = (k === "year" || k === "question_count" || k === "occurrences") ? "desc" : "asc"; }
        renderTable();
      });
    });
    $all("[data-view]", el("results-area")).forEach(function (b) {
      b.addEventListener("click", function () { openExam(Number(b.getAttribute("data-view"))); });
    });
  }

  /* ---------------- 入試問題 表示モーダル ---------------- */
  function openExam(examId) {
    UI.openModal(el("exam-modal"));
    el("exam-modal-body").innerHTML = '<div class="loading-row"><span class="spinner"></span> 読み込み中…</div>';
    Api.getExam(examId).then(function (data) {
      var ex = data.exam;
      el("exam-modal-title").textContent = ex.year + "年 " + ex.university_name + " " + ex.schedule;
      var body = "";
      (ex.questions || []).forEach(function (q) {
        body += '<div class="exam-section">';
        body += renderField("問題", "fa-circle-question", q.problem_text);
        if (q.answer_text && q.answer_text.trim()) body += renderField("解答", "fa-circle-check", q.answer_text);
        if (q.commentary_text && q.commentary_text.trim()) body += renderField("解説", "fa-comment-dots", q.commentary_text);
        body += "</div>";
      });
      el("exam-modal-body").innerHTML = body || '<div class="empty">大問が登録されていません。</div>';
    }).catch(function (e) {
      el("exam-modal-body").innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation ic"></i>' + esc(e.message) + "</div>";
    });
  }
  function renderField(label, icon, text) {
    var r = Markup.render(text);
    return '<div style="margin-bottom:14px">' +
      '<div class="exam-section-title"><i class="fa-solid ' + icon + '"></i> ' + esc(label) + "</div>" +
      '<div class="exam-doc">' + r.html + "</div></div>";
  }

  /* ---------------- コーパス分析 ---------------- */
  function ensureCorpusControls() {
    // ストップワード / 語彙リストの選択肢を最新化
    var sw = el("corpus-stopword");
    var swSel = sw.value;
    sw.innerHTML = '<option value="">なし（除外しない）</option>';
    Store.getStopwordLists().forEach(function (l, i) {
      var o = create("option"); o.value = String(i); o.textContent = l.name + "（" + l.words.length + "語）"; sw.appendChild(o);
    });
    if (sw.querySelector('option[value="0"]') && swSel === "") sw.value = "0"; else sw.value = swSel;

    var vc = el("corpus-vocab");
    var vcSel = vc.value;
    vc.innerHTML = '<option value="">なし</option>';
    Store.getVocabLists().forEach(function (l, i) {
      var o = create("option"); o.value = String(i); o.textContent = l.name + "（" + l.words.length + "語）"; vc.appendChild(o);
    });
    vc.value = vcSel;
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
    var qs = state.corpus || [];
    // ドキュメント（KWIC用ラベル付き）と全文
    var docs = qs.map(function (q) {
      var text = Markup.strip([q.problem_text, q.answer_text, q.commentary_text].join("\n"));
      return { text: text, label: q.year + " " + q.university_name + " 大問" + q.question_number };
    });
    var fullText = docs.map(function (d) { return d.text; }).join("\n");
    var tokens = Corpus.tokenize(fullText);

    if (!tokens.length) {
      el("corpus-results").innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-inbox ic"></i>英文テキストが見つかりませんでした。問題を登録してください。</div></div>';
      return;
    }

    var swIdx = el("corpus-stopword").value;
    var stopSet = swIdx !== "" ? Corpus.toSet(Store.getStopwordLists()[Number(swIdx)].words) : null;
    var vcIdx = el("corpus-vocab").value;
    var vocab = vcIdx !== "" ? Store.getVocabLists()[Number(vcIdx)] : null;
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
      var cov = Corpus.coverage(tokens, Corpus.toSet(vocab.words));
      html += '<div class="card"><div class="card-head"><h3><i class="fa-solid fa-list-check ic"></i> 語彙カバー率: ' + esc(vocab.name) + "</h3></div>" +
        '<div class="grid-2"><div><canvas id="cov-chart" height="160"></canvas></div>' +
        '<div class="stat-grid">' +
        stat((cov.tokenCoverage * 100).toFixed(1) + "%", "延べ語カバー率") +
        stat((cov.typeCoverage * 100).toFixed(1) + "%", "異なり語カバー率") +
        stat(cov.tokenInList, "リスト内 (延べ)") +
        stat(cov.offList.length, "リスト外 異なり語") +
        "</div></div>";
      html += '<div class="table-wrap" style="margin-top:14px"><table class="data freq-table"><thead><tr>' +
        "<th>リスト外の語（頻度順）</th><th>頻度</th></tr></thead><tbody>";
      cov.offList.slice(0, 30).forEach(function (o) {
        html += "<tr><td>" + esc(o.word) + "</td><td class='num'>" + o.count + "</td></tr>";
      });
      html += "</tbody></table></div></div>";
    }

    el("corpus-results").innerHTML = html;

    // チャート描画
    destroyCharts();
    drawFreqChart(top);
    if (vocab) drawCovChart(Corpus.coverage(tokens, Corpus.toSet(vocab.words)));
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
      data: { labels: ["リスト内", "リスト外"],
        datasets: [{ data: [cov.tokenInList, cov.tokenTotal - cov.tokenInList],
          backgroundColor: ["rgba(5,150,105,.8)", "rgba(37,99,235,.25)"] }] },
      options: { plugins: { legend: { position: "bottom" } } }
    });
  }

  var global = window;
  document.addEventListener("DOMContentLoaded", init);
})();
