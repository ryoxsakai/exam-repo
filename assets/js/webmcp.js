/* =====================================================================
   webmcp.js — WebMCP tools for browser-based AI agents

   WebMCP is progressively enhanced: unsupported browsers keep all existing
   site behaviour, while supported browsers can discover the read-only tools
   below through document.modelContext.
   ===================================================================== */
(function (global) {
  "use strict";

  var controller = null;
  var registeredNames = [];

  function modelContext() {
    return global.document && global.document.modelContext;
  }

  function boundedLimit(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(100, Math.floor(n)));
  }

  function optionalString(value, name, maxLength) {
    if (value === undefined || value === null || value === "") return "";
    var text = String(value).trim();
    if (text.length > maxLength) throw new Error(name + "は" + maxLength + "文字以内で指定してください。");
    return text;
  }

  function requiredPositiveInteger(value, name) {
    var n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(name + "は1以上の整数で指定してください。");
    return n;
  }

  function optionalYear(value) {
    if (value === undefined || value === null || value === "") return "";
    var year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw new Error("yearは1900〜2200の整数で指定してください。");
    }
    return year;
  }

  function includesQuery(row, query) {
    if (!query) return true;
    var needle = query.toLocaleLowerCase("ja");
    return [row.name, row.reading, row.abbreviation].some(function (value) {
      return String(value || "").toLocaleLowerCase("ja").indexOf(needle) >= 0;
    });
  }

  function readOnlyTool(definition) {
    definition.annotations = {
      readOnlyHint: true,
      untrustedContentHint: true
    };
    return definition;
  }

  var tools = [
    readOnlyTool({
      name: "exam_list_universities",
      title: "大学一覧",
      description: "入試問題データベースに登録されている大学を、大学名・よみ・略称で検索して一覧取得します。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", maxLength: 100, description: "大学名・よみ・略称の部分一致。省略時は全大学。" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50, description: "最大取得件数。" }
        },
        additionalProperties: false
      },
      execute: async function (args) {
        args = args || {};
        var query = optionalString(args.query, "query", 100);
        var limit = boundedLimit(args.limit, 50);
        var data = await Api.getUniversities();
        var matches = (data.universities || []).filter(function (row) { return includesQuery(row, query); });
        return {
          universities: matches.slice(0, limit).map(function (row) {
            return { id: row.id, name: row.name, reading: row.reading || "", abbreviation: row.abbreviation || "" };
          }),
          match_count: matches.length,
          returned_count: Math.min(matches.length, limit)
        };
      }
    }),

    readOnlyTool({
      name: "exam_list_exams",
      title: "試験一覧",
      description: "登録済みの入試を大学名・年度・方式で絞り込み、試験IDを含む一覧を取得します。",
      inputSchema: {
        type: "object",
        properties: {
          university_name: { type: "string", maxLength: 100, description: "大学名の部分一致。" },
          year: { type: "integer", minimum: 1900, maximum: 2200, description: "入試年度。" },
          schedule: { type: "string", maxLength: 100, description: "前期・後期などの方式。" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50, description: "最大取得件数。" }
        },
        additionalProperties: false
      },
      execute: async function (args) {
        args = args || {};
        var universityName = optionalString(args.university_name, "university_name", 100);
        var year = optionalYear(args.year);
        var schedule = optionalString(args.schedule, "schedule", 100);
        var limit = boundedLimit(args.limit, 50);
        var data = await Api.getExams({ universityName: universityName, year: year, schedule: schedule });
        var matches = data.exams || [];
        return {
          exams: matches.slice(0, limit).map(function (row) {
            return { exam_id: row.id, university_name: row.university_name, year: row.year, schedule: row.schedule };
          }),
          match_count: matches.length,
          returned_count: Math.min(matches.length, limit)
        };
      }
    }),

    readOnlyTool({
      name: "exam_search_questions",
      title: "問題検索",
      description: "問題・解答・解説のキーワードと、大学・年度・方式・問題種別・大問番号で入試問題を検索します。本文が必要ならexam_get_questionを続けて使います。",
      inputSchema: {
        type: "object",
        properties: {
          word: { type: "string", maxLength: 200, description: "問題・解答・解説に含まれるキーワード。" },
          university_name: { type: "string", maxLength: 100, description: "大学名の部分一致。" },
          year: { type: "integer", minimum: 1900, maximum: 2200, description: "入試年度。" },
          schedule: { type: "string", maxLength: 100, description: "前期・後期などの方式。" },
          category: { type: "string", maxLength: 100, description: "長文・文法・英作文などの問題種別。" },
          question_number: { type: "integer", minimum: 1, description: "大問番号。" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 30, description: "最大取得件数。" }
        },
        additionalProperties: false
      },
      execute: async function (args) {
        args = args || {};
        var questionNumber = args.question_number === undefined || args.question_number === null || args.question_number === ""
          ? null : requiredPositiveInteger(args.question_number, "question_number");
        var limit = boundedLimit(args.limit, 30);
        var data = await Api.search({
          word: optionalString(args.word, "word", 200),
          universityName: optionalString(args.university_name, "university_name", 100),
          year: optionalYear(args.year),
          schedule: optionalString(args.schedule, "schedule", 100),
          category: optionalString(args.category, "category", 100)
        });
        var matches = (data.results || []).filter(function (row) {
          return questionNumber === null || Number(row.question_number) === questionNumber;
        });
        return {
          results: matches.slice(0, limit).map(function (row) {
            return {
              exam_id: row.exam_id,
              question_number: row.question_number,
              label: row.label || "",
              category: row.category || "",
              university_name: row.university_name,
              year: row.year,
              schedule: row.schedule,
              title: row.zenyaku_title || "",
              occurrences: row.total_occurrences || 0
            };
          }),
          match_count: matches.length,
          returned_count: Math.min(matches.length, limit)
        };
      }
    }),

    readOnlyTool({
      name: "exam_get_question",
      title: "大問詳細",
      description: "試験IDと大問番号を指定し、登録されている問題・解答・解説をデータベース原文のまま取得します。",
      inputSchema: {
        type: "object",
        properties: {
          exam_id: { type: "integer", minimum: 1, description: "試験ID。" },
          question_number: { type: "integer", minimum: 1, description: "大問番号。" }
        },
        required: ["exam_id", "question_number"],
        additionalProperties: false
      },
      execute: async function (args) {
        args = args || {};
        var examId = requiredPositiveInteger(args.exam_id, "exam_id");
        var questionNumber = requiredPositiveInteger(args.question_number, "question_number");
        var data = await Api.getExam(examId);
        var exam = data.exam || {};
        var question = (exam.questions || []).find(function (row) {
          return Number(row.question_number) === questionNumber;
        });
        if (!question) throw new Error("指定された大問が見つかりません。");
        return {
          exam: { exam_id: exam.id, university_name: exam.university_name, year: exam.year, schedule: exam.schedule },
          question: {
            question_number: question.question_number,
            label: question.label || "",
            category: question.category || "",
            problem_text: question.problem_text || "",
            answer_text: question.answer_text || "",
            commentary_text: question.commentary_text || ""
          }
        };
      }
    }),

    readOnlyTool({
      name: "exam_open_question",
      title: "問題を画面に表示",
      description: "指定した試験の大問を、現在の入試問題データベース画面の閲覧モーダルに表示します。データは変更しません。",
      inputSchema: {
        type: "object",
        properties: {
          exam_id: { type: "integer", minimum: 1, description: "試験ID。" },
          question_number: { type: "integer", minimum: 1, description: "大問番号。" }
        },
        required: ["exam_id", "question_number"],
        additionalProperties: false
      },
      execute: async function (args) {
        args = args || {};
        var examId = requiredPositiveInteger(args.exam_id, "exam_id");
        var questionNumber = requiredPositiveInteger(args.question_number, "question_number");
        var data = await Api.getExam(examId);
        var exam = data.exam || {};
        var question = (exam.questions || []).find(function (row) {
          return Number(row.question_number) === questionNumber;
        });
        if (!question) throw new Error("指定された大問が見つかりません。");
        global.dispatchEvent(new CustomEvent("exam:webmcp-open-question", {
          detail: { examId: examId, questionNumber: questionNumber }
        }));
        return {
          opened: true,
          exam_id: examId,
          question_number: questionNumber,
          university_name: exam.university_name,
          year: exam.year,
          schedule: exam.schedule
        };
      }
    })
  ];

  async function register() {
    var context = modelContext();
    if (!context || typeof context.registerTool !== "function") return false;
    if (controller) return true;

    controller = new AbortController();
    registeredNames = [];
    try {
      for (var i = 0; i < tools.length; i += 1) {
        await context.registerTool(tools[i], { signal: controller.signal });
        registeredNames.push(tools[i].name);
      }
      return true;
    } catch (error) {
      controller.abort();
      controller = null;
      registeredNames = [];
      console.warn("WebMCPツールを登録できませんでした。", error);
      return false;
    }
  }

  function unregister() {
    if (controller) controller.abort();
    controller = null;
    registeredNames = [];
  }

  global.ExamWebMCP = {
    supported: function () { return Boolean(modelContext() && typeof modelContext().registerTool === "function"); },
    register: register,
    unregister: unregister,
    registeredTools: function () { return registeredNames.slice(); }
  };

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", register, { once: true });
  } else {
    register();
  }
})(window);
