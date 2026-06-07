"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createExam, testConnection } from "@/lib/api";

interface QuestionField {
  id: string;
  questionNumber: number;
  problemText: string;
  answerText: string;
  commentaryText: string;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const SCHEDULES = ["前期", "後期", "一般前期", "一般後期", "推薦", "AO", "その他"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => CURRENT_YEAR - i);

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"form" | "config">("form");

  // ── Config ────────────────────────────────────────────────────────
  const [workerUrl, setWorkerUrl] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    try {
      setWorkerUrl(localStorage.getItem("cf_worker_url") || "");
    } catch { /* ignore */ }
  }, []);

  const saveConfig = useCallback(() => {
    try {
      const url = workerUrl.replace(/\/$/, "");
      localStorage.setItem("cf_worker_url", url);
      setWorkerUrl(url);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
    } catch {
      alert("設定の保存に失敗しました");
    }
  }, [workerUrl]);

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      await testConnection();
      setTestResult({ ok: true, msg: "接続成功！Worker は正常に動作しています。" });
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
    } finally {
      setTestingConn(false);
    }
  };

  // ── Exam form ────────────────────────────────────────────────────
  const [universityName, setUniversityName] = useState("");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [schedule, setSchedule] = useState("前期");
  const [questions, setQuestions] = useState<QuestionField[]>([
    { id: genId(), questionNumber: 1, problemText: "", answerText: "", commentaryText: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const addQuestion = () =>
    setQuestions((prev) => [
      ...prev,
      { id: genId(), questionNumber: prev.length + 1, problemText: "", answerText: "", commentaryText: "" },
    ]);

  const removeQuestion = (id: string) =>
    setQuestions((prev) =>
      prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, questionNumber: i + 1 }))
    );

  const updateQuestion = (id: string, field: keyof QuestionField, value: string | number) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, [field]: value } : q)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    if (!universityName.trim()) { setSubmitError("大学名を入力してください"); return; }
    if (!questions.some((q) => q.problemText.trim())) {
      setSubmitError("少なくとも1つの問題文を入力してください"); return;
    }

    setSubmitting(true);
    try {
      await createExam({
        universityName: universityName.trim(),
        year: Number(year),
        schedule,
        questions: questions
          .filter((q) => q.problemText.trim())
          .map((q) => ({
            questionNumber: q.questionNumber,
            problemText: q.problemText,
            answerText: q.answerText,
            commentaryText: q.commentaryText,
          })),
      });

      setSubmitSuccess(true);
      setUniversityName("");
      setYear(String(CURRENT_YEAR));
      setSchedule("前期");
      setQuestions([{ id: genId(), questionNumber: 1, problemText: "", answerText: "", commentaryText: "" }]);
      setTimeout(() => setSubmitSuccess(false), 5000);
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] shadow-xl">
        <div className="max-w-4xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/15 rounded-xl p-2.5">
                <i className="fa-solid fa-gear text-white text-xl" />
              </div>
              <div>
                <h1 className="text-xl font-700 text-white">管理画面</h1>
                <p className="text-blue-200 text-xs">Admin — Medical Exam Database</p>
              </div>
            </div>
            <a href="/" className="flex items-center gap-2 text-white/80 hover:text-white text-sm transition">
              <i className="fa-solid fa-arrow-left text-xs" />
              公開ページへ
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Tab nav */}
        <div className="flex gap-2 mb-6">
          {(["form", "config"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-600 transition ${
                activeTab === tab
                  ? "bg-white shadow-md text-[#1e3a5f] border border-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <i className={`fa-solid ${tab === "form" ? "fa-plus-circle" : "fa-plug"}`} />
              {tab === "form" ? "問題登録" : "設定"}
            </button>
          ))}
        </div>

        {/* ── Config tab ── */}
        {activeTab === "config" && (
          <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6 space-y-6">
            <div>
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
                <i className="fa-brands fa-cloudflare text-orange-500" />
                Cloudflare Worker 設定
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                設定はブラウザの localStorage に保存されます。
              </p>
            </div>

            {/* Worker URL — the critical setting */}
            <div className="rounded-xl border-2 border-[#6b46c1]/30 bg-purple-50 p-4 space-y-3">
              <label className="block text-sm font-700 text-[#6b46c1] mb-1">
                <i className="fa-solid fa-link mr-2" />
                Worker URL <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-slate-500 -mt-1">
                デプロイ後に Cloudflare ダッシュボードに表示される URL（例:{" "}
                <code className="bg-white border border-slate-200 px-1 rounded text-xs">
                  https://medical-exam-worker.YOUR_SUBDOMAIN.workers.dev
                </code>
                ）
              </p>
              <input
                type="url"
                value={workerUrl}
                onChange={(e) => setWorkerUrl(e.target.value)}
                placeholder="https://medical-exam-worker.xxx.workers.dev"
                className="w-full rounded-lg border border-[#6b46c1]/30 bg-white px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={saveConfig}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-600 bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] hover:opacity-90 transition shadow-md"
                >
                  <i className="fa-solid fa-save" />
                  保存する
                </button>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={!workerUrl || testingConn}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-600 hover:bg-slate-50 transition disabled:opacity-40"
                >
                  {testingConn ? (
                    <><i className="fa-solid fa-spinner fa-spin" />接続確認中...</>
                  ) : (
                    <><i className="fa-solid fa-wifi" />接続テスト</>
                  )}
                </button>
                {configSaved && (
                  <span className="text-emerald-600 text-sm flex items-center gap-1.5">
                    <i className="fa-solid fa-check-circle" />保存しました
                  </span>
                )}
              </div>
              {testResult && (
                <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                  testResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                }`}>
                  <i className={`fa-solid ${testResult.ok ? "fa-check-circle" : "fa-triangle-exclamation"} mt-0.5`} />
                  <span>{testResult.msg}</span>
                </div>
              )}
            </div>

            {/* Setup guide */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-5 py-4 text-sm text-blue-800">
              <p className="font-700 mb-2 flex items-center gap-1.5">
                <i className="fa-solid fa-circle-info text-[#0891b2]" />
                Worker のデプロイ手順
              </p>
              <ol className="list-decimal ml-5 space-y-1.5 text-xs text-blue-700">
                <li>
                  <code className="bg-blue-100 px-1 rounded">npm install -g wrangler</code> でインストール
                </li>
                <li>
                  <code className="bg-blue-100 px-1 rounded">wrangler login</code> で Cloudflare にログイン
                </li>
                <li>
                  Cloudflare ダッシュボード → Workers &amp; Pages → D1 でデータベース（
                  <code className="bg-blue-100 px-1 rounded">medical-exam-db</code>）を作成
                </li>
                <li>
                  <code className="bg-blue-100 px-1 rounded">wrangler.toml</code> の{" "}
                  <code className="bg-blue-100 px-1 rounded">database_id</code> を更新
                </li>
                <li>
                  <code className="bg-blue-100 px-1 rounded">npm run db:migrate</code> でスキーマを適用
                </li>
                <li>
                  <code className="bg-blue-100 px-1 rounded">npm run worker:deploy</code> で Worker をデプロイ
                </li>
                <li>表示された Worker URL を上のフィールドに入力して保存</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── Form tab ── */}
        {activeTab === "form" && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Exam info */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6">
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2 mb-4">
                <i className="fa-solid fa-file-circle-plus text-[#6b46c1]" />
                試験情報
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
                    大学名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={universityName}
                    onChange={(e) => setUniversityName(e.target.value)}
                    placeholder="例: 東京大学"
                    required
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
                    年度 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}年</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
                    試験区分 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
                  >
                    {SCHEDULES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Questions */}
            <div className="space-y-4">
              {questions.map((q, idx) => (
                <QuestionBlock
                  key={q.id}
                  question={q}
                  index={idx}
                  total={questions.length}
                  onChange={(field, value) => updateQuestion(q.id, field, value)}
                  onRemove={() => removeQuestion(q.id)}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={addQuestion}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[#6b46c1]/30 text-[#6b46c1] text-sm font-600 hover:border-[#6b46c1]/60 hover:bg-purple-50 transition"
            >
              <i className="fa-solid fa-plus-circle" />
              大問を追加する
            </button>

            {submitError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
                <i className="fa-solid fa-triangle-exclamation text-red-500 mt-0.5" />
                <div>
                  <p className="text-red-700 text-sm">{submitError}</p>
                  {submitError.includes("Worker URL") && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("config")}
                      className="mt-2 text-xs text-red-600 underline"
                    >
                      設定タブを開く
                    </button>
                  )}
                </div>
              </div>
            )}

            {submitSuccess && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-3">
                <i className="fa-solid fa-check-circle text-emerald-500" />
                <p className="text-emerald-700 text-sm font-600">問題を登録しました</p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-8 py-3 rounded-xl text-white font-700 bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] hover:opacity-90 transition disabled:opacity-50 shadow-lg text-sm"
              >
                {submitting ? (
                  <><i className="fa-solid fa-spinner fa-spin" />登録中...</>
                ) : (
                  <><i className="fa-solid fa-upload" />データベースに登録する</>
                )}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

// ── Question block ─────────────────────────────────────────────────

interface QuestionBlockProps {
  question: QuestionField;
  index: number;
  total: number;
  onChange: (field: keyof QuestionField, value: string | number) => void;
  onRemove: () => void;
}

function QuestionBlock({ question, index, total, onChange, onRemove }: QuestionBlockProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 cursor-pointer select-none"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="question-badge text-sm">大問 {question.questionNumber}</span>
          {collapsed && question.problemText && (
            <span className="text-xs text-slate-400 truncate max-w-xs">
              {question.problemText.slice(0, 60)}…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-slate-400 hover:text-red-500 transition p-1"
              title="この大問を削除"
            >
              <i className="fa-solid fa-minus-circle text-sm" />
            </button>
          )}
          <i className={`fa-solid fa-chevron-${collapsed ? "down" : "up"} text-slate-400 text-xs`} />
        </div>
      </div>

      {!collapsed && (
        <div className="p-5 space-y-4">
          {/* Problem text */}
          <div>
            <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1.5">
              問題文 <span className="text-red-500">*</span>
              <span className="ml-2 text-slate-300 font-400 normal-case text-[11px]">
                {"{{問1}}"} {"[[1]]"} ==highlight== etc. のマークアップ対応
              </span>
            </label>
            <textarea
              value={question.problemText}
              onChange={(e) => onChange("problemText", e.target.value)}
              placeholder={"{{問1}}\n次の英文を読み、設問に答えよ。\n\nThe immune system..."}
              rows={8}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent resize-y"
            />
          </div>

          {/* Answer */}
          <div>
            <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1.5">
              <i className="fa-solid fa-check-circle text-emerald-500 mr-1" />
              解答
            </label>
            <textarea
              value={question.answerText}
              onChange={(e) => onChange("answerText", e.target.value)}
              placeholder="解答を入力..."
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent resize-y"
            />
          </div>

          {/* Commentary */}
          <div>
            <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1.5">
              <i className="fa-solid fa-lightbulb text-[#0891b2] mr-1" />
              解説
            </label>
            <textarea
              value={question.commentaryText}
              onChange={(e) => onChange("commentaryText", e.target.value)}
              placeholder="解説を入力..."
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent resize-y"
            />
          </div>

          {/* Markup reference */}
          <details className="rounded-lg bg-slate-50 border border-slate-200">
            <summary className="px-4 py-2.5 text-xs font-600 text-slate-500 cursor-pointer hover:text-slate-700 list-none flex items-center gap-1.5">
              <i className="fa-solid fa-code" />
              マークアップ記法の一覧
            </summary>
            <div className="px-4 pb-4 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                ["[[1]] / [[A]]", "番号付きブランクバッジ"],
                ["__text__", "下線"],
                ["~~2~~", "下付き文字 (H₂O)"],
                ["^^st^^", "上付き文字 (1ˢᵗ)"],
                ["==text==", "黄色ハイライト"],
                ["==text==:blue", "カラーハイライト (blue/red/purple/pink/green/aqua)"],
                ["{{問1}}", "問題番号バッジ（区切り線付き）"],
                ["((A)) text", "選択肢（自動インデント）"],
                ["##word::訳##", "脚注（自動番号付き）"],
                ["----", "スタイル付き水平線"],
              ].map(([syntax, desc]) => (
                <div key={syntax} className="flex items-start gap-2">
                  <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[#6b46c1] font-mono shrink-0 text-[11px]">
                    {syntax}
                  </code>
                  <span className="text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
