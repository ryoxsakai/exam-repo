"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createExam, getUniversities } from "@/lib/api";

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
const RECENT_YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i);

const MARKUP_ITEMS: [string, string][] = [
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
];

// ── Generic edit modal ─────────────────────────────────────────────

interface EditModalProps {
  title: string;
  value: string;
  onClose: () => void;
  onSave: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  suggestions?: string[];
  suggestionLabel?: string;
}

function EditModal({
  title, value, onClose, onSave,
  inputMode = "text", type = "text",
  suggestions, suggestionLabel,
}: EditModalProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const commit = () => { if (draft.trim()) onSave(draft.trim()); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-700 text-[#1e3a5f]">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <input
          ref={inputRef}
          type={type}
          inputMode={inputMode}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onClose(); }}
          className="w-full rounded-xl border-2 border-[#6b46c1]/30 bg-slate-50 px-4 py-3 text-base font-600 text-[#1e3a5f] focus:outline-none focus:ring-0 focus:border-[#6b46c1]"
        />

        {suggestions && (
          <div>
            {suggestionLabel && (
              <p className="text-xs text-slate-400 mb-2">{suggestionLabel}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft(String(s))}
                  className={`px-3 py-1 rounded-full text-xs font-600 border transition ${
                    draft === String(s)
                      ? "bg-[#6b46c1] text-white border-[#6b46c1]"
                      : "bg-white text-slate-600 border-slate-200 hover:border-[#6b46c1]/50 hover:text-[#6b46c1]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-600 hover:bg-slate-50 transition"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] text-white text-sm font-700 hover:opacity-90 transition disabled:opacity-40"
          >
            <i className="fa-solid fa-check mr-1.5" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Markup reference modal ─────────────────────────────────────────

function MarkupModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
            <i className="fa-solid fa-code text-[#6b46c1]" />
            マークアップ記法一覧
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="space-y-1">
          {MARKUP_ITEMS.map(([syntax, desc]) => (
            <div key={syntax} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
              <code className="bg-slate-100 border border-slate-200 px-2 py-1 rounded text-[#6b46c1] font-mono text-xs shrink-0 w-40">
                {syntax}
              </code>
              <span className="text-sm text-slate-600">{desc}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-600 hover:bg-slate-50 transition"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

// ── EditableField: value chip + gear icon ──────────────────────────

interface EditableFieldProps {
  label: string;
  value: string;
  onEdit: () => void;
  suffix?: string;
}

function EditableField({ label, value, onEdit, suffix }: EditableFieldProps) {
  return (
    <div>
      <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 min-h-[42px]">
          <span className="text-sm font-600 text-[#1e3a5f]">{value}{suffix}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex-shrink-0 w-[42px] h-[42px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-[#6b46c1] hover:border-[#6b46c1]/40 transition"
          title={`${label}を編集`}
        >
          <i className="fa-solid fa-gear text-sm" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"form" | "config">("form");

  // Config
  const [workerUrl, setWorkerUrl] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    try { setWorkerUrl(localStorage.getItem("cf_worker_url") || ""); } catch { /* ignore */ }
  }, []);

  const saveConfig = useCallback(() => {
    try {
      const url = workerUrl.replace(/\/$/, "");
      localStorage.setItem("cf_worker_url", url);
      setWorkerUrl(url);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
    } catch { alert("設定の保存に失敗しました"); }
  }, [workerUrl]);

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      await getUniversities();
      setTestResult({ ok: true, msg: "接続成功！Worker は正常に動作しています。" });
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
    } finally { setTestingConn(false); }
  };

  // Exam form
  const [universities, setUniversities] = useState<string[]>([]);
  const [universityName, setUniversityName] = useState("");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [schedule, setSchedule] = useState("前期");
  const [questions, setQuestions] = useState<QuestionField[]>([
    { id: genId(), questionNumber: 1, problemText: "", answerText: "", commentaryText: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [modal, setModal] = useState<"year" | "schedule" | "university" | null>(null);

  const loadUniversities = useCallback(async () => {
    try {
      const data = await getUniversities();
      setUniversities(data.universities.map((u) => u.name));
    } catch {
      // Silently ignore — Worker URL may not be configured yet
    }
  }, []);

  useEffect(() => {
    loadUniversities();
  }, [loadUniversities]);

  const addQuestion = () =>
    setQuestions((prev) => [
      ...prev,
      { id: genId(), questionNumber: prev.length + 1, problemText: "", answerText: "", commentaryText: "" },
    ]);

  const removeQuestion = (id: string) =>
    setQuestions((prev) =>
      prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, questionNumber: i + 1 }))
    );

  const moveQuestion = (id: string, dir: "up" | "down") => {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      if (idx < 0) return prev;
      const next = dir === "up" ? idx - 1 : idx + 1;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };

  const updateQuestion = (id: string, field: keyof QuestionField, value: string | number) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, [field]: value } : q)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);
    if (!universityName.trim()) { setSubmitError("大学名を選択または入力してください"); return; }
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
      await loadUniversities();
      setTimeout(() => setSubmitSuccess(false), 5000);
    } catch (err) {
      setSubmitError(String(err));
    } finally { setSubmitting(false); }
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
            <Link href="/" className="flex items-center gap-2 text-white/80 hover:text-white text-sm transition">
              <i className="fa-solid fa-arrow-left text-xs" />
              公開ページへ
            </Link>
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
              <p className="text-sm text-slate-400 mt-1">設定はブラウザの localStorage に保存されます。</p>
            </div>
            <div className="rounded-xl border-2 border-[#6b46c1]/30 bg-purple-50 p-4 space-y-3">
              <label className="block text-sm font-700 text-[#6b46c1] mb-1">
                <i className="fa-solid fa-link mr-2" />
                Worker URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={workerUrl}
                onChange={(e) => setWorkerUrl(e.target.value)}
                placeholder="https://medical-exam-worker.xxx.workers.dev"
                className="w-full rounded-lg border border-[#6b46c1]/30 bg-white px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={saveConfig}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-600 bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] hover:opacity-90 transition shadow-md">
                  <i className="fa-solid fa-save" />保存
                </button>
                <button type="button" onClick={handleTestConnection} disabled={!workerUrl || testingConn}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-600 hover:bg-slate-50 transition disabled:opacity-40">
                  {testingConn
                    ? <><i className="fa-solid fa-spinner fa-spin" />確認中...</>
                    : <><i className="fa-solid fa-wifi" />接続テスト</>}
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
                {/* University — dropdown + gear icon */}
                <div>
                  <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
                    大学名 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={universityName}
                      onChange={(e) => setUniversityName(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
                    >
                      <option value="">選択または追加 ↓</option>
                      {universityName && !universities.includes(universityName) && (
                        <option value={universityName}>{universityName}</option>
                      )}
                      {universities.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setModal("university")}
                      className="flex-shrink-0 w-[42px] h-[42px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-[#6b46c1] hover:border-[#6b46c1]/40 transition"
                      title="大学名を入力/追加"
                    >
                      <i className="fa-solid fa-gear text-sm" />
                    </button>
                  </div>
                </div>

                {/* Year — editable via modal */}
                <EditableField
                  label="年度"
                  value={year}
                  suffix="年"
                  onEdit={() => setModal("year")}
                />

                {/* Schedule — editable via modal */}
                <EditableField
                  label="試験区分"
                  value={schedule}
                  onEdit={() => setModal("schedule")}
                />
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
                  onMoveUp={idx > 0 ? () => moveQuestion(q.id, "up") : undefined}
                  onMoveDown={idx < questions.length - 1 ? () => moveQuestion(q.id, "down") : undefined}
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
                    <button type="button" onClick={() => setActiveTab("config")}
                      className="mt-2 text-xs text-red-600 underline">
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
                {submitting
                  ? <><i className="fa-solid fa-spinner fa-spin" />登録中...</>
                  : <><i className="fa-solid fa-upload" />登録</>}
              </button>
            </div>
          </form>
        )}
      </main>

      {/* ── Modals ── */}
      {modal === "year" && (
        <EditModal
          title="年度を編集"
          value={year}
          type="number"
          inputMode="numeric"
          suggestions={RECENT_YEARS.map(String)}
          suggestionLabel="クイック選択"
          onClose={() => setModal(null)}
          onSave={(v) => { setYear(v); setModal(null); }}
        />
      )}
      {modal === "schedule" && (
        <EditModal
          title="試験区分を編集"
          value={schedule}
          suggestions={SCHEDULES}
          suggestionLabel="よく使う区分"
          onClose={() => setModal(null)}
          onSave={(v) => { setSchedule(v); setModal(null); }}
        />
      )}
      {modal === "university" && (
        <EditModal
          title="大学名を入力"
          value={universityName}
          suggestions={universities.length > 0 ? universities : undefined}
          suggestionLabel={universities.length > 0 ? "登録済みの大学" : undefined}
          onClose={() => setModal(null)}
          onSave={(v) => {
            setUniversityName(v);
            if (!universities.includes(v)) setUniversities((prev) => [...prev, v].sort());
            setModal(null);
          }}
        />
      )}
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
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function QuestionBlock({ question, index, total, onChange, onRemove, onMoveUp, onMoveDown }: QuestionBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showMarkup, setShowMarkup] = useState(false);

  // suppress unused-var warning
  void index;

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 select-none">
        {/* Left — collapse click area */}
        <div
          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
          onClick={() => setCollapsed((v) => !v)}
        >
          {/* Editable question number — stops click from collapsing */}
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-700 text-slate-500 uppercase tracking-wide">大問</span>
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              value={question.questionNumber}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) onChange("questionNumber", v);
              }}
              className="w-14 text-center rounded-lg border-2 border-[#6b46c1]/30 bg-white px-1 py-1 text-sm font-800 text-[#1e3a5f] focus:outline-none focus:border-[#6b46c1] transition"
            />
          </div>
          {collapsed && question.problemText && (
            <span className="text-xs text-slate-400 truncate">
              {question.problemText.slice(0, 60)}…
            </span>
          )}
        </div>

        {/* Right — action buttons */}
        <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-[#6b46c1] disabled:opacity-20 disabled:cursor-not-allowed transition"
            title="上に移動"
          >
            <i className="fa-solid fa-chevron-up text-xs" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-[#6b46c1] disabled:opacity-20 disabled:cursor-not-allowed transition"
            title="下に移動"
          >
            <i className="fa-solid fa-chevron-down text-xs" />
          </button>
          {total > 1 && (
            <button
              type="button"
              onClick={onRemove}
              className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-red-500 transition"
              title="この大問を削除"
            >
              <i className="fa-solid fa-minus-circle text-sm" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 transition ml-1"
          >
            <i className={`fa-solid fa-chevron-${collapsed ? "down" : "up"} text-xs`} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-5 space-y-4">
          {/* Problem text */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide">
                問題文 <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowMarkup(true)}
                className="flex items-center gap-1 text-xs text-[#6b46c1] hover:text-[#1e3a5f] transition font-600"
              >
                <i className="fa-solid fa-code text-[10px]" />
                記法一覧
              </button>
            </div>
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
        </div>
      )}

      {showMarkup && <MarkupModal onClose={() => setShowMarkup(false)} />}
    </div>
  );
}
