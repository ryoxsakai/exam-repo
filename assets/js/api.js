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
    updateUniversity: function (id, name, reading, abbreviation) {
      var b = { name: name, reading: reading || "" };
      if (abbreviation !== undefined) b.abbreviation = abbreviation || "";
      return call("/api/universities/" + id, { method: "PUT", body: JSON.stringify(b) });
    },
    deleteUniversity: function (id) { return call("/api/universities/" + id, { method: "DELETE" }); },
    getExams:         function (p) { return call("/api/exams" + qs(p)); },
    getExam:          function (id) { return call("/api/exams/" + id); },
    createExam:       function (d) { return call("/api/exams", { method: "POST", body: JSON.stringify(d) }); },
    updateExam:       function (id, d) { return call("/api/exams/" + id, { method: "PUT", body: JSON.stringify(d) }); },
    deleteExam:       function (id) { return call("/api/exams/" + id, { method: "DELETE" }); },
    deleteQuestion:   function (examId, qnum) { return call("/api/questions/" + examId + "/" + qnum, { method: "DELETE" }); },
    search:           function (p) { return call("/api/search" + qs(p)); },
    getCorpus:        function () { return call("/api/corpus"); },
    // 画像を R2 へアップロード（生バイトを送信）。{ key, path } を返す。
    uploadImage:      async function (file) {
      var b = base();
      var res;
      try {
        res = await fetch(b + "/api/upload", {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        });
      } catch (e) { throw new Error("アップロードに失敗しました（通信エラー）。"); }
      if (!res.ok) {
        var data = {};
        try { data = await res.json(); } catch (e) {}
        throw new Error(data.error || data.message || ("アップロード失敗 " + res.status));
      }
      return res.json();
    },
    // 画像の表示用フルURL（保存された path から組み立て）
    imageUrl:         function (path) { return base().replace(/\/+$/, "") + path; },
    // PDF取り込み：SSE でフェーズを逐次受信。onEvent({phase, ...}) を都度呼ぶ。
    // 戻り値の Promise はストリーム終了時に解決（ネットワーク失敗時は reject）。
    ingestPdfStream:  function (d, apiKey, onEvent) {
      var b;
      try { b = base(); } catch (e) { return Promise.reject(e); }
      return fetch(b + "/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-anthropic-key": apiKey || "" },
        body: JSON.stringify(d)
      }).catch(function () {
        throw new Error("通信に失敗しました（Worker URL や CORS 設定を確認してください）。");
      }).then(function (res) {
        var ct = res.headers.get("Content-Type") || "";
        if (ct.indexOf("text/event-stream") < 0 || !res.body) {
          // SSE でない（バリデーション 400 等）→ JSON エラーとして処理
          return res.json().catch(function () { return {}; }).then(function (data) {
            throw new Error(data.message || data.error || ("APIエラー " + res.status));
          });
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split("\n\n");
            buf = parts.pop();
            parts.forEach(function (chunk) {
              var lines = chunk.split("\n");
              for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf("data:") === 0) {
                  var s = lines[i].slice(5).trim();
                  if (s) { try { onEvent(JSON.parse(s)); } catch (e) {} }
                }
              }
            });
            return pump();
          });
        }
        return pump();
      });
    },
    // Anthropic API キーの疎通確認。成功で {ok:true, model}、失敗時は reject。
    testAnthropic:    function (apiKey) {
      var b;
      try { b = base(); } catch (e) { return Promise.reject(e); }
      return fetch(b + "/api/anthropic-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-anthropic-key": apiKey || "" }
      }).catch(function () {
        throw new Error("通信に失敗しました（Worker URL や CORS 設定を確認してください）。");
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.message || data.error || ("APIエラー " + res.status));
          return data;
        });
      });
    },
    // 登録データの一括置換。dryRun=true で件数のみ取得。
    replaceRegistered: function (rules, dryRun) {
      return call("/api/replace", { method: "POST", body: JSON.stringify({ rules: rules, dryRun: !!dryRun }) });
    },
    // 外部LLM取り込み用プロンプト（{ prompt } を返す）。
    // universityName を渡すとその大学の注意点がプロンプトに追記される。
    getIngestPrompt:  function (universityName) { return call("/api/ingest-prompt" + qs({ universityName: universityName })); },
    getWordLists:     function (type) { return call("/api/wordlists" + qs({ type: type })); },
    createWordList:   function (d) { return call("/api/wordlists", { method: "POST", body: JSON.stringify(d) }); },
    updateWordList:   function (id, d) { return call("/api/wordlists/" + id, { method: "PUT", body: JSON.stringify(d) }); },
    deleteWordList:   function (id) { return call("/api/wordlists/" + id, { method: "DELETE" }); },
    testConnection:   function () { return call("/api/universities"); },
    // お気に入り（Googleログイン必須。Auth の ID トークンを Authorization ヘッダで送る）
    getFavorites:     async function () {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorites", { headers: { "Authorization": "Bearer " + token } });
    },
    addFavorite:      async function (examId, questionNumber) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ examId: examId, questionNumber: questionNumber })
      });
    },
    removeFavorite:   async function (examId, questionNumber) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorites/" + examId + "/" + questionNumber, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + token }
      });
    },
    // お気に入りフォルダ（フォルダ分け・階層化・並べ替え）
    createFavoriteFolder: async function (name, parentId) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorite-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ name: name, parentId: parentId == null ? null : parentId })
      });
    },
    renameFavoriteFolder: async function (id, name) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorite-folders/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ name: name })
      });
    },
    deleteFavoriteFolder: async function (id) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorite-folders/" + id, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + token }
      });
    },
    // items: [{type:"folder", id} | {type:"favorite", examId, questionNumber}]（並べ替え後の順序）
    reorderFavorites: async function (parentId, items) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/favorite-folders/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ parentId: parentId == null ? null : parentId, items: items })
      });
    },
    // ユーザー設定（Googleログイン必須。現状はタブ並び順のみ。端末をまたいで同期する）
    getUserSettings:  async function () {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/user-settings", { headers: { "Authorization": "Bearer " + token } });
    },
    updateUserSettings: async function (data) {
      var token = await Auth.getIdToken();
      if (!token) throw new Error("ログインが必要です。");
      return call("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify(data)
      });
    }
  };

  global.Api = Api;
})(window);
