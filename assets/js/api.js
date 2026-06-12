/* =====================================================================
   api.js — Cloudflare Worker API クライアント
   Worker URL は Store(localStorage) から取得。
   ===================================================================== */
(function (global) {
  "use strict";

  function base() {
    var b = Store.getWorkerUrl();
    if (!b) throw new Error("Worker URL が未設定です。設定ページ →「接続設定」で Worker URL を入力・保存してください。");
    return b;
  }

  async function call(path, options) {
    var res;
    try {
      res = await fetch(base() + path, Object.assign({
        headers: { "Content-Type": "application/json" }
      }, options || {}));
    } catch (e) {
      throw new Error("通信に失敗しました（Worker URL や CORS 設定を確認してください）。");
    }
    if (!res.ok) {
      var data = {};
      try { data = await res.json(); } catch (e) {}
      throw new Error(data.message || data.error || ("APIエラー " + res.status));
    }
    return res.json();
  }

  function qs(params) {
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== "") q.set(k, params[k]);
    });
    var s = q.toString();
    return s ? "?" + s : "";
  }

  var Api = {
    getConfig:        function () { return call("/api/config"); },
    updateConfig:     function (data) { return call("/api/config", { method: "PUT", body: JSON.stringify(data) }); },
    getUniversities:  function () { return call("/api/universities"); },
    deleteUniversity: function (id) { return call("/api/universities/" + id, { method: "DELETE" }); },
    getExams:         function (p) { return call("/api/exams" + qs(p)); },
    getExam:          function (id) { return call("/api/exams/" + id); },
    createExam:       function (d) { return call("/api/exams", { method: "POST", body: JSON.stringify(d) }); },
    updateExam:       function (id, d) { return call("/api/exams/" + id, { method: "PUT", body: JSON.stringify(d) }); },
    deleteExam:       function (id) { return call("/api/exams/" + id, { method: "DELETE" }); },
    deleteQuestion:   function (examId, qnum) { return call("/api/questions/" + examId + "/" + qnum, { method: "DELETE" }); },
    search:           function (p) { return call("/api/search" + qs(p)); },
    getCorpus:        function () { return call("/api/corpus"); },
    testConnection:   function () { return call("/api/universities"); }
  };

  global.Api = Api;
})(window);
