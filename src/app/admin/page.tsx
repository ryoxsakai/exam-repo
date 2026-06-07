"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  createExam, getUniversities, deleteUniversity, deleteExam,
  getConfig, updateConfig,
  getExam, updateExam, searchExams,
  type SearchResult,
} from "@/lib/api";
import { parseTextFull } from "@/lib/parser";
import { DEFAULT_SCHEDULES } from "@/components/SearchBar";

// ── Types ──────────────────────────────────────────────────────────

interface QuestionField {
  id: string;
  questionNumber: number;
  problemText: string;
  answerText: string;
  commentaryText: string;
}

// ── Constants & utilities ──────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_YEAR_PRESETS = Array.from({ length: 8 }, (_, i) => String(CURRENT_YEAR - i));

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function loadStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}

function saveStorage<T>(key: string, val: T): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

const YEARS_KEY = "cf_year_presets";
const SCHEDULES_KEY = "cf_custom_schedules";

// Markup toolbar button definitions
const TOOLBAR_BUTTONS = [
  { label: "空所",   title: "空所 [[1]]",            before: "[[",    after: "]]",    ph: "1"    },
  { label: "下線",   title: "下線 __text__",          before: "__",    after: "__",    ph: "text" },
  { label: "HL",     title: "ハイライト ==text==",     before: "==",    after: "==",    ph: "text" },
  { label: "問",     title: "問題番号バッジ {{問1}}",  before: "{{問",  after: "}}",    ph: "1"    },
  { label: "選択肢", title: "選択肢 ((A))",           before: "((",    after: ")) ",   ph: "A"    },
  { label: "脚注",   title: "脚注 ##word::訳##",      before: "##",    after: "::##",  ph: "word" },
  { label: "下付",   title: "下付き文字 ~~2~~",       before: "~~",    after: "~~",    ph: "2"    },
  { label: "上付",   title: "上付き文字 ^^st^^",      before: "^^",    after: "^^",    ph: "st"   },
  { label: "──",    title: "水平線 ----",             before: "\n----\n", after: "",   ph: ""     },
] as const;

const MARKUP_REFERENCE = [
  { syntax: "[[1]] / [[A]]", example: "[[1]]と[[2]]",     desc: "番号付き空所" },
  { syntax: "__text__",      example: "__重要語句__",       desc: "下線" },
  { syntax: "~~N~~",         example: "H~~2~~O",            desc: "下付き文字" },
  { syntax: "^^text^^",      example: "1^^st^^",            desc: "上付き文字" },
  { syntax: "==text==",      example: "==重要==",           desc: "黄ハイライト" },
  { syntax: "==text==:blue", example: "==語彙==:blue",      desc: "青ハイライト" },
  { syntax: "{{問1}}",       example: "{{問1}}",            desc: "問題番号バッジ" },
  { syntax: "((A)) text",    example: "((ア)) 選択肢A",     desc: "選択肢" },
  { syntax: "##word::訳##",  example: "##T cell::T細胞##",  desc: "脚注" },
  { syntax: "----",          example: "----",               desc: "水平線" },
];

// ── MarkupPreview ──────────────────────────────────────────────────

function MarkupPreview({ text }: { text: string }) {
  const { elements } = parseTextFull(text);
  return <span className="parsed-text text-sm">{elements}</span>;
}

// ── MarkupToolbar ──────────────────────────────────────────────────

interface MarkupToolbarProps {
  taRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onShowReference: () => void;
}

function MarkupToolbar({ taRef, value, onChange, onShowReference }: MarkupToolbarProps) {
  const insert = (before: string, after: string, ph: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = value.substring(s, e);
    const inner = sel || ph;
    const newVal = value.slice(0, s) + before + inner + after + value.slice(e);
    onChange(newVal);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + inner.length);
    });
  };

  return (
    <div className="flex items-center gap-1 flex-wrap mb-1.5">
      {TOOLBAR_BUTTONS.map((btn) => (
        <button
          key={btn.label}
          type="button"
          title={btn.title}
          onClick={() => insert(btn.before, btn.after, btn.ph)}
          className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-[11px] font-600 text-slate-600 hover:border-[#6b46c1]/50 hover:text-[#6b46c1] hover:bg-purple-50 transition font-mono"
        >
          {btn.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onShowReference}
        className="ml-auto flex items-center gap-1 text-[11px] text-[#6b46c1] hover:text-[#1e3a5f] font-600 transition"
      >
        <i className="fa-solid fa-circle-question text-[10px]" />
        記法一覧
      </button>
    </div>
  );
}

// ── EditModal ──────────────────────────────────────────────────────

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

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);
  const commit = () => { if (draft.trim()) onSave(draft.trim()); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
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
          className="w-full rounded-xl border-2 border-[#6b46c1]/30 bg-slate-50 px-4 py-3 text-base font-600 text-[#1e3a5f] focus:outline-none focus:border-[#6b46c1]"
        />
        {suggestions && (
          <div>
            {suggestionLabel && <p className="text-xs text-slate-400 mb-2">{suggestionLabel}</p>}
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => setDraft(s)}
                  className={`px-3 py-1 rounded-full text-xs font-600 border transition ${
                    draft === s
                      ? "bg-[#6b46c1] text-white border-[#6b46c1]"
                      : "bg-white text-slate-600 border-slate-200 hover:border-[#6b46c1]/50 hover:text-[#6b46c1]"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-600 hover:bg-slate-50 transition">
            キャンセル
          </button>
          <button type="button" onClick={commit} disabled={!draft.trim()}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] text-white text-sm font-700 hover:opacity-90 transition disabled:opacity-40">
            <i className="fa-solid fa-check mr-1.5" />保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MarkupReferenceModal ───────────────────────────────────────────

function MarkupReferenceModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
            <i className="fa-solid fa-code text-[#6b46c1]" />
            マークアップ記法一覧
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Header row */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-[10px] font-700 uppercase tracking-wide text-slate-400 px-1">
          <span>記法</span><span>表示例</span><span>説明</span>
        </div>

        <div className="space-y-0">
          {MARKUP_REFERENCE.map(({ syntax, example, desc }) => (
            <div key={syntax} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center py-2.5 border-b border-slate-100 last:border-0 px-1">
              <code className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-[#6b46c1] font-mono text-[11px] whitespace-nowrap">
                {syntax}
              </code>
              <div className="flex-shrink-0 min-w-[80px] text-center">
                <MarkupPreview text={example} />
              </div>
              <span className="text-xs text-slate-600">{desc}</span>
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-600 hover:bg-slate-50 transition">
          閉じる
        </button>
      </div>
    </div>
  );
}

// ── FullMarkupPreview ──────────────────────────────────────────────

function FullMarkupPreview({ text }: { text: string }) {
  const { elements } = parseTextFull(text);
  return <div className="parsed-text">{elements}</div>;
}

// ── PreviewModal ───────────────────────────────────────────────────

function PreviewModal({ question, onClose }: { question: QuestionField; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
            <i className="fa-solid fa-eye text-[#6b46c1]" />
            プレビュー（大問 {question.questionNumber}）
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {question.problemText.trim() && (
          <div>
            <p className="text-[10px] font-700 uppercase tracking-wider text-slate-400 mb-2">問題文</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <FullMarkupPreview text={question.problemText} />
            </div>
          </div>
        )}

        {question.answerText.trim() && (
          <div>
            <p className="text-[10px] font-700 uppercase tracking-wider text-slate-400 mb-2">解答</p>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
              <FullMarkupPreview text={question.answerText} />
            </div>
          </div>
        )}

        {question.commentaryText.trim() && (
          <div>
            <p className="text-[10px] font-700 uppercase tracking-wider text-slate-400 mb-2">解説</p>
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-4">
              <FullMarkupPreview text={question.commentaryText} />
            </div>
          </div>
        )}

        {!question.problemText.trim() && !question.answerText.trim() && !question.commentaryText.trim() && (
          <p className="text-center text-sm text-slate-400 py-6 italic">表示するテキストがありません</p>
        )}

        <button type="button" onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-600 hover:bg-slate-50 transition">
          閉じる
        </button>
      </div>
    </div>
  );
}

// ── EditableField ──────────────────────────────────────────────────

function EditableField({ label, value, onEdit, suffix }: { label: string; value: string; onEdit: () => void; suffix?: string }) {
  return (
    <div>
      <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 min-h-[42px]">
          <span className="text-sm font-600 text-[#1e3a5f]">{value}{suffix}</span>
        </div>
        <button type="button" onClick={onEdit}
          className="flex-shrink-0 w-[42px] h-[42px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-[#6b46c1] hover:border-[#6b46c1]/40 transition"
          title={`${label}を編集`}>
          <i className="fa-solid fa-gear text-sm" />
        </button>
      </div>
    </div>
  );
}

// ── AdminPage ──────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"form" | "manage" | "config">("form");

  // Config
  const [workerUrl, setWorkerUrl] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Manage
  const [universities, setUniversities] = useState<Array<{ id: number; name: string }>>([]);
  const [uniDeleting, setUniDeleting] = useState<Set<number>>(new Set());
  const [examDeleting, setExamDeleting] = useState<Set<number>>(new Set());
  const [scheduleOptions, setScheduleOptions] = useState<string[]>(DEFAULT_SCHEDULES);
  const [yearPresets, setYearPresets] = useState<string[]>(DEFAULT_YEAR_PRESETS);
  const [newSchedule, setNewSchedule] = useState("");
  const [newYear, setNewYear] = useState("");

  // Exam list (for edit)
  const [examList, setExamList] = useState<SearchResult[]>([]);
  const [examListLoading, setExamListLoading] = useState(false);
  const [editingExamId, setEditingExamId] = useState<number | null>(null);

  // Form
  const [universityName, setUniversityName] = useState("");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [schedule, setSchedule] = useState("");
  const [questions, setQuestions] = useState<QuestionField[]>([
    { id: genId(), questionNumber: 1, problemText: "", answerText: "", commentaryText: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Modals
  const [modal, setModal] = useState<"year" | "schedule" | "university" | null>(null);
  const [showMarkupRef, setShowMarkupRef] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState<QuestionField | null>(null);

  // Site title
  const [siteTitle, setSiteTitle] = useState("医学部入試問題データベース");

  // ── Init ──
  useEffect(() => {
    try {
      setWorkerUrl(localStorage.getItem("cf_worker_url") || "");
      setSiteTitle(localStorage.getItem("cf_site_title") || "医学部入試問題データベース");
    } catch { /* ignore */ }
    setScheduleOptions(loadStorage(SCHEDULES_KEY, DEFAULT_SCHEDULES));
    setYearPresets(loadStorage(YEARS_KEY, DEFAULT_YEAR_PRESETS));
  }, []);

  useEffect(() => {
    if (!schedule && scheduleOptions.length > 0) setSchedule(scheduleOptions[0]);
  }, [scheduleOptions, schedule]);

  // ── Remote loaders ──
  const loadRemote = useCallback(async () => {
    try {
      const [uniData, cfg] = await Promise.all([getUniversities(), getConfig()]);
      setUniversities(uniData.universities);
      setScheduleOptions(cfg.schedules);
      setYearPresets(cfg.year_presets);
      saveStorage(SCHEDULES_KEY, cfg.schedules);
      saveStorage(YEARS_KEY, cfg.year_presets);
      if (cfg.site_title) {
        setSiteTitle(cfg.site_title);
        try { localStorage.setItem("cf_site_title", cfg.site_title); } catch { /* ignore */ }
      }
    } catch { /* Worker URL not set yet */ }
  }, []);

  const loadUniversities = useCallback(async () => {
    try {
      const data = await getUniversities();
      setUniversities(data.universities);
    } catch { /* ignore */ }
  }, []);

  const loadExamList = useCallback(async () => {
    setExamListLoading(true);
    try {
      const data = await searchExams({});
      setExamList(data.results);
    } catch { /* ignore */ }
    finally { setExamListLoading(false); }
  }, []);

  useEffect(() => {
    loadRemote();
    loadExamList();
  }, [loadRemote, loadExamList]);

  // ── Edit ──
  const loadExamForEdit = useCallback(async (examId: number) => {
    try {
      const data = await getExam(examId);
      const exam = data.exam;
      setEditingExamId(examId);
      setUniversityName(exam.university_name);
      setYear(String(exam.year));
      setSchedule(exam.schedule);
      setQuestions(exam.questions.map((q) => ({
        id: genId(),
        questionNumber: q.question_number,
        problemText: q.problem_text,
        answerText: q.answer_text,
        commentaryText: q.commentary_text,
      })));
      setSubmitError(null);
      setSubmitSuccess(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      alert(`読み込みに失敗しました: ${String(err)}`);
    }
  }, []);

  const exitEditMode = useCallback(() => {
    setEditingExamId(null);
    setUniversityName("");
    setYear(String(CURRENT_YEAR));
    setSchedule(scheduleOptions[0] || "前期");
    setQuestions([{ id: genId(), questionNumber: 1, problemText: "", answerText: "", commentaryText: "" }]);
    setSubmitError(null);
    setSubmitSuccess(false);
  }, [scheduleOptions]);

  // ── Config ──
  const saveConfig = useCallback(() => {
    try {
      const url = workerUrl.replace(/\/$/, "");
      localStorage.setItem("cf_worker_url", url);
      localStorage.setItem("cf_site_title", siteTitle);
      setWorkerUrl(url);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
      updateConfig({ site_title: siteTitle }).catch(() => {});
    } catch { alert("設定の保存に失敗しました"); }
  }, [workerUrl, siteTitle]);

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      await loadRemote();
      await loadExamList();
      setTestResult({ ok: true, msg: "接続成功！Worker は正常に動作しています。" });
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
    } finally { setTestingConn(false); }
  };

  // ── Manage ──
  const handleDeleteUniversity = async (u: { id: number; name: string }) => {
    if (!window.confirm(`「${u.name}」を削除しますか？`)) return;
    setUniDeleting((prev) => new Set(prev).add(u.id));
    try {
      await deleteUniversity(u.id);
      await loadUniversities();
    } catch (err) {
      alert(String(err));
    } finally {
      setUniDeleting((prev) => { const s = new Set(prev); s.delete(u.id); return s; });
    }
  };

  const handleDeleteExam = async (exam: SearchResult) => {
    if (!window.confirm(`「${exam.university_name} ${exam.year}年 ${exam.schedule}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    setExamDeleting((prev) => new Set(prev).add(exam.exam_id));
    try {
      await deleteExam(exam.exam_id);
      if (editingExamId === exam.exam_id) exitEditMode();
      await loadExamList();
    } catch (err) {
      alert(String(err));
    } finally {
      setExamDeleting((prev) => { const s = new Set(prev); s.delete(exam.exam_id); return s; });
    }
  };

  const addSchedule = async () => {
    const v = newSchedule.trim();
    if (!v || scheduleOptions.includes(v)) return;
    const updated = [...scheduleOptions, v];
    setScheduleOptions(updated);
    setNewSchedule("");
    saveStorage(SCHEDULES_KEY, updated);
    try { await updateConfig({ schedules: updated }); } catch { /* ignore */ }
  };

  const removeSchedule = async (s: string) => {
    const updated = scheduleOptions.filter((o) => o !== s);
    setScheduleOptions(updated);
    saveStorage(SCHEDULES_KEY, updated);
    try { await updateConfig({ schedules: updated }); } catch { /* ignore */ }
  };

  const addYear = async () => {
    const v = newYear.trim();
    if (!v || isNaN(Number(v)) || yearPresets.includes(v)) return;
    const updated = [...yearPresets, v].sort((a, b) => Number(b) - Number(a));
    setYearPresets(updated);
    setNewYear("");
    saveStorage(YEARS_KEY, updated);
    try { await updateConfig({ year_presets: updated }); } catch { /* ignore */ }
  };

  const removeYear = async (y: string) => {
    const updated = yearPresets.filter((p) => p !== y);
    setYearPresets(updated);
    saveStorage(YEARS_KEY, updated);
    try { await updateConfig({ year_presets: updated }); } catch { /* ignore */ }
  };

  // ── Form / questions ──
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
    const qPayload = questions
      .filter((q) => q.problemText.trim())
      .map((q) => ({
        questionNumber: q.questionNumber,
        problemText: q.problemText,
        answerText: q.answerText,
        commentaryText: q.commentaryText,
      }));
    const sch = schedule || scheduleOptions[0] || "前期";

    setSubmitting(true);
    try {
      if (editingExamId) {
        await updateExam(editingExamId, {
          universityName: universityName.trim(),
          year: Number(year),
          schedule: sch,
          questions: qPayload,
        });
        setSubmitSuccess(true);
        await loadExamList();
        setTimeout(() => setSubmitSuccess(false), 5000);
      } else {
        await createExam({ universityName: universityName.trim(), year: Number(year), schedule: sch, questions: qPayload });
        setSubmitSuccess(true);
        exitEditMode();
        await Promise.all([loadExamList(), loadUniversities()]);
        setTimeout(() => setSubmitSuccess(false), 5000);
      }
    } catch (err) {
      setSubmitError(String(err));
    } finally { setSubmitting(false); }
  };

  // ── Add-option input row helper ──
  const addRow = (val: string, setVal: (v: string) => void, onAdd: () => void, placeholder: string, type = "text") => (
    <div className="flex gap-2 mt-2">
      <input type={type} value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent" />
      <button type="button" onClick={onAdd}
        className="px-4 py-2 rounded-lg bg-[#6b46c1] text-white text-sm font-600 hover:bg-[#5a389f] transition">
        追加
      </button>
    </div>
  );

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
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {([
            ["form",   "fa-plus-circle", "問題登録"],
            ["manage", "fa-database",    "管理"],
            ["config", "fa-plug",        "設定"],
          ] as const).map(([tab, icon, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-600 transition ${
                activeTab === tab
                  ? "bg-white shadow-md text-[#1e3a5f] border border-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}>
              <i className={`fa-solid ${icon}`} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Config tab ── */}
        {activeTab === "config" && (
          <div className="space-y-5">
            {/* Site title */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6 space-y-4">
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
                <i className="fa-solid fa-heading text-[#6b46c1]" />
                サイトタイトル
              </h2>
              <div className="space-y-2">
                <input
                  type="text"
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                  placeholder="医学部入試問題データベース"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent"
                />
                <p className="text-xs text-slate-400">公開ページのヘッダーに表示されるタイトルです。保存ボタンで確定します。</p>
              </div>
            </div>

            {/* Custom domain */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6 space-y-4">
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
                <i className="fa-solid fa-globe text-[#0891b2]" />
                独自ドメイン
              </h2>
              <div className="rounded-xl bg-sky-50 border border-sky-200 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-circle-check text-emerald-500" />
                  <span className="text-sm font-600 text-slate-700">現在の公開URL</span>
                </div>
                <p className="text-sm font-mono text-[#0891b2] font-600 pl-6">
                  https://exam.lrnr.jp/
                </p>
                <p className="text-xs text-slate-500 pl-6 leading-relaxed">
                  独自ドメインの変更はリポジトリの <code className="bg-slate-100 px-1 rounded">public/CNAME</code> と
                  GitHub Actions の <code className="bg-slate-100 px-1 rounded">cname:</code> 設定を更新し、
                  GitHub Pages の設定でドメインを変更してください。
                </p>
              </div>
            </div>

            {/* Worker URL */}
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
                <i className="fa-solid fa-link mr-2" />Worker URL <span className="text-red-500">*</span>
              </label>
              <input type="url" value={workerUrl} onChange={(e) => setWorkerUrl(e.target.value)}
                placeholder="https://medical-exam-worker.xxx.workers.dev"
                className="w-full rounded-lg border border-[#6b46c1]/30 bg-white px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent" />
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
          </div>
        )}

        {/* ── Manage tab ── */}
        {activeTab === "manage" && (
          <div className="space-y-6">
            {/* Exam list */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2">
                  <i className="fa-solid fa-list text-[#6b46c1]" />
                  問題一覧
                  {examListLoading && <i className="fa-solid fa-spinner fa-spin text-slate-400 text-sm" />}
                </h2>
                <button type="button" onClick={loadExamList}
                  className="text-xs text-slate-400 hover:text-[#6b46c1] transition flex items-center gap-1">
                  <i className="fa-solid fa-rotate-right" />再読み込み
                </button>
              </div>
              {examList.length === 0 ? (
                <p className="text-sm text-slate-400 italic text-center py-4">
                  {workerUrl ? "登録されている問題はありません" : "設定タブで Worker URL を設定してください"}
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {examList.map((exam) => (
                    <div key={exam.exam_id} className="flex items-center gap-3 py-3 group">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-600 text-slate-700">{exam.university_name}</span>
                        <span className="text-xs text-slate-400 ml-2">{exam.year}年</span>
                        <span className="text-xs text-slate-400 ml-1">{exam.schedule}</span>
                        {exam.question_count > 0 && (
                          <span className="text-[10px] text-slate-300 ml-1.5">{exam.question_count}問</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={async () => { await loadExamForEdit(exam.exam_id); setActiveTab("form"); }}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-[#6b46c1] px-2.5 py-1 rounded-lg hover:bg-purple-50 transition"
                        >
                          <i className="fa-solid fa-pen-to-square text-[10px]" />編集
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExam(exam)}
                          disabled={examDeleting.has(exam.exam_id)}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition disabled:opacity-40"
                        >
                          {examDeleting.has(exam.exam_id)
                            ? <i className="fa-solid fa-spinner fa-spin" />
                            : <i className="fa-solid fa-trash-can" />}
                          削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Universities */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6">
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2 mb-1">
                <i className="fa-solid fa-university text-[#6b46c1]" />大学管理
              </h2>
              <p className="text-xs text-slate-400 mb-4">大学は試験登録時に自動追加。試験のない大学のみ削除できます。</p>
              {universities.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-4 text-center">
                  <i className="fa-solid fa-circle-info mr-1" />
                  {workerUrl ? "登録された大学はありません" : "設定タブで Worker URL を設定してください"}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {universities.map((u) => (
                    <li key={u.id} className="flex items-center justify-between py-2.5">
                      <span className="text-sm font-600 text-slate-700">{u.name}</span>
                      <button type="button" onClick={() => handleDeleteUniversity(u)} disabled={uniDeleting.has(u.id)}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition disabled:opacity-40">
                        {uniDeleting.has(u.id)
                          ? <i className="fa-solid fa-spinner fa-spin" />
                          : <i className="fa-solid fa-trash-can" />}
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={loadUniversities}
                className="mt-3 flex items-center gap-1.5 text-xs text-[#6b46c1] hover:text-[#1e3a5f] transition">
                <i className="fa-solid fa-rotate-right" />再読み込み
              </button>
            </div>

            {/* Schedule options */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6">
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2 mb-1">
                <i className="fa-solid fa-tags text-[#059669]" />試験区分
              </h2>
              <p className="text-xs text-slate-400 mb-4">D1に保存。どのブラウザでも同じ選択肢が表示されます。</p>
              <div className="flex flex-wrap gap-2">
                {scheduleOptions.map((s) => (
                  <span key={s} className="flex items-center gap-1 pl-3 pr-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 font-600">
                    {s}
                    <button type="button" onClick={() => removeSchedule(s)} className="text-emerald-400 hover:text-red-500 transition ml-0.5">
                      <i className="fa-solid fa-xmark text-xs" />
                    </button>
                  </span>
                ))}
              </div>
              {addRow(newSchedule, setNewSchedule, addSchedule, "新しい区分を入力…")}
            </div>

            {/* Year presets */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6">
              <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2 mb-1">
                <i className="fa-solid fa-calendar text-[#0891b2]" />年度プリセット
              </h2>
              <p className="text-xs text-slate-400 mb-4">年度モーダルのクイック選択候補。D1に保存されます。</p>
              <div className="flex flex-wrap gap-2">
                {yearPresets.map((y) => (
                  <span key={y} className="flex items-center gap-1 pl-3 pr-2 py-1 rounded-full bg-sky-50 border border-sky-200 text-sm text-sky-800 font-600">
                    {y}年
                    <button type="button" onClick={() => removeYear(y)} className="text-sky-400 hover:text-red-500 transition ml-0.5">
                      <i className="fa-solid fa-xmark text-xs" />
                    </button>
                  </span>
                ))}
              </div>
              {addRow(newYear, setNewYear, addYear, "例: 2010", "number")}
            </div>
          </div>
        )}

        {/* ── Form tab ── */}
        {activeTab === "form" && (
          <div className="space-y-6">
            {/* Exam list */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-700 text-[#1e3a5f] flex items-center gap-2">
                  <i className="fa-solid fa-list text-[#6b46c1]" />
                  問題一覧
                  {examListLoading && <i className="fa-solid fa-spinner fa-spin text-slate-400" />}
                </h2>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={loadExamList}
                    className="text-xs text-slate-400 hover:text-[#6b46c1] transition" title="再読み込み">
                    <i className="fa-solid fa-rotate-right" />
                  </button>
                  {editingExamId && (
                    <button type="button" onClick={exitEditMode}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-600 hover:bg-slate-200 transition">
                      <i className="fa-solid fa-plus text-[10px]" />新規作成
                    </button>
                  )}
                </div>
              </div>

              {examList.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4 italic">
                  {workerUrl ? "登録されている問題はありません" : "設定タブで Worker URL を設定してください"}
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-0.5">
                  {examList.map((exam) => (
                    <div
                      key={exam.exam_id}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition ${
                        editingExamId === exam.exam_id
                          ? "bg-[#6b46c1]/10 border border-[#6b46c1]/25"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm font-600 text-slate-700 truncate">{exam.university_name}</span>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{exam.year}年</span>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{exam.schedule}</span>
                        {exam.question_count > 0 && (
                          <span className="text-[10px] text-slate-300 whitespace-nowrap">{exam.question_count}問</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => loadExamForEdit(exam.exam_id)}
                        className={`flex items-center gap-1 text-xs font-600 px-2.5 py-1 rounded-lg transition whitespace-nowrap ml-2 ${
                          editingExamId === exam.exam_id
                            ? "text-[#6b46c1] bg-[#6b46c1]/10"
                            : "text-slate-400 hover:text-[#6b46c1] hover:bg-purple-50"
                        }`}
                      >
                        <i className="fa-solid fa-pen-to-square text-[10px]" />
                        編集
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Edit mode indicator */}
            {editingExamId && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#6b46c1]/8 border border-[#6b46c1]/20">
                <i className="fa-solid fa-pen-to-square text-[#6b46c1]" />
                <span className="text-sm font-600 text-[#6b46c1]">
                  編集モード: {universityName} {year}年 {schedule}
                </span>
                <button type="button" onClick={exitEditMode}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-600 transition">
                  キャンセル
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Exam info */}
              <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6">
                <h2 className="text-base font-700 text-[#1e3a5f] flex items-center gap-2 mb-4">
                  <i className="fa-solid fa-file-circle-plus text-[#6b46c1]" />試験情報
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* University */}
                  <div>
                    <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1">
                      大学名 <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <select value={universityName} onChange={(e) => setUniversityName(e.target.value)}
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent">
                        <option value="">選択または追加 ↓</option>
                        {universityName && !universities.some(u => u.name === universityName) && (
                          <option value={universityName}>{universityName}</option>
                        )}
                        {universities.map((u) => (
                          <option key={u.id} value={u.name}>{u.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setModal("university")}
                        className="flex-shrink-0 w-[42px] h-[42px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-[#6b46c1] hover:border-[#6b46c1]/40 transition"
                        title="大学名を入力/追加">
                        <i className="fa-solid fa-gear text-sm" />
                      </button>
                    </div>
                  </div>

                  <EditableField label="年度" value={year} suffix="年" onEdit={() => setModal("year")} />
                  <EditableField label="試験区分" value={schedule} onEdit={() => setModal("schedule")} />
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
                    onShowMarkupRef={() => setShowMarkupRef(true)}
                    onPreview={() => setPreviewQuestion(q)}
                  />
                ))}
              </div>

              <button type="button" onClick={addQuestion}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[#6b46c1]/30 text-[#6b46c1] text-sm font-600 hover:border-[#6b46c1]/60 hover:bg-purple-50 transition">
                <i className="fa-solid fa-plus-circle" />大問を追加する
              </button>

              {submitError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
                  <i className="fa-solid fa-triangle-exclamation text-red-500 mt-0.5" />
                  <div>
                    <p className="text-red-700 text-sm">{submitError}</p>
                    {submitError.includes("Worker URL") && (
                      <button type="button" onClick={() => setActiveTab("config")} className="mt-2 text-xs text-red-600 underline">
                        設定タブを開く
                      </button>
                    )}
                  </div>
                </div>
              )}

              {submitSuccess && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-3">
                  <i className="fa-solid fa-check-circle text-emerald-500" />
                  <p className="text-emerald-700 text-sm font-600">
                    {editingExamId ? "更新しました" : "登録しました"}
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <button type="submit" disabled={submitting}
                  className="flex items-center gap-2 px-8 py-3 rounded-xl text-white font-700 bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] hover:opacity-90 transition disabled:opacity-50 shadow-lg text-sm">
                  {submitting
                    ? <><i className="fa-solid fa-spinner fa-spin" />{editingExamId ? "更新中..." : "登録中..."}</>
                    : <><i className={`fa-solid ${editingExamId ? "fa-floppy-disk" : "fa-upload"}`} />{editingExamId ? "更新" : "登録"}</>}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Modals */}
      {modal === "year" && (
        <EditModal title="年度を編集" value={year} type="number" inputMode="numeric"
          suggestions={yearPresets} suggestionLabel="クイック選択"
          onClose={() => setModal(null)} onSave={(v) => { setYear(v); setModal(null); }} />
      )}
      {modal === "schedule" && (
        <EditModal title="試験区分を編集" value={schedule}
          suggestions={scheduleOptions} suggestionLabel="登録済みの区分"
          onClose={() => setModal(null)} onSave={(v) => { setSchedule(v); setModal(null); }} />
      )}
      {modal === "university" && (
        <EditModal title="大学名を入力" value={universityName}
          suggestions={universities.length > 0 ? universities.map(u => u.name) : undefined}
          suggestionLabel={universities.length > 0 ? "登録済みの大学" : undefined}
          onClose={() => setModal(null)}
          onSave={(v) => {
            setUniversityName(v);
            if (!universities.some(u => u.name === v)) {
              setUniversities((prev) => [...prev, { id: -Date.now(), name: v }].sort((a, b) => a.name.localeCompare(b.name)));
            }
            setModal(null);
          }} />
      )}
      {showMarkupRef && <MarkupReferenceModal onClose={() => setShowMarkupRef(false)} />}
      {previewQuestion && <PreviewModal question={previewQuestion} onClose={() => setPreviewQuestion(null)} />}
    </div>
  );
}

// ── QuestionBlock ──────────────────────────────────────────────────

interface QuestionBlockProps {
  question: QuestionField;
  index: number;
  total: number;
  onChange: (field: keyof QuestionField, value: string | number) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onShowMarkupRef: () => void;
  onPreview: () => void;
}

function QuestionBlock({ question, index, total, onChange, onRemove, onMoveUp, onMoveDown, onShowMarkupRef, onPreview }: QuestionBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Auto-show sections if they already have content (e.g. when editing existing exam)
  const [showAnswer, setShowAnswer] = useState(() => !!question.answerText.trim());
  const [showCommentary, setShowCommentary] = useState(() => !!question.commentaryText.trim());

  const problemRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const commentaryRef = useRef<HTMLTextAreaElement>(null);

  void index;

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 select-none">
        <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" onClick={() => setCollapsed((v) => !v)}>
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-700 text-slate-500 uppercase tracking-wide">大問</span>
            <input
              type="number" inputMode="numeric" pattern="[0-9]*" min={1}
              value={question.questionNumber}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) onChange("questionNumber", v); }}
              className="w-14 text-center rounded-lg border-2 border-[#6b46c1]/30 bg-white px-1 py-1 text-sm font-800 text-[#1e3a5f] focus:outline-none focus:border-[#6b46c1] transition"
            />
          </div>
          {collapsed && question.problemText && (
            <span className="text-xs text-slate-400 truncate">{question.problemText.slice(0, 60)}…</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
          <button type="button" onClick={onMoveUp} disabled={!onMoveUp}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-[#6b46c1] disabled:opacity-20 disabled:cursor-not-allowed transition" title="上に移動">
            <i className="fa-solid fa-chevron-up text-xs" />
          </button>
          <button type="button" onClick={onMoveDown} disabled={!onMoveDown}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-[#6b46c1] disabled:opacity-20 disabled:cursor-not-allowed transition" title="下に移動">
            <i className="fa-solid fa-chevron-down text-xs" />
          </button>
          <button type="button" onClick={onPreview}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-[#6b46c1] transition" title="プレビュー">
            <i className="fa-solid fa-eye text-xs" />
          </button>
          {total > 1 && (
            <button type="button" onClick={onRemove}
              className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-red-500 transition" title="削除">
              <i className="fa-solid fa-minus-circle text-sm" />
            </button>
          )}
          <button type="button" onClick={() => setCollapsed((v) => !v)}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 transition ml-1">
            <i className={`fa-solid fa-chevron-${collapsed ? "down" : "up"} text-xs`} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-5 space-y-4">
          {/* Problem */}
          <div>
            <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide mb-1.5">
              問題文 <span className="text-red-500">*</span>
            </label>
            <MarkupToolbar taRef={problemRef} value={question.problemText}
              onChange={(v) => onChange("problemText", v)} onShowReference={onShowMarkupRef} />
            <textarea ref={problemRef} value={question.problemText}
              onChange={(e) => onChange("problemText", e.target.value)}
              placeholder={"{{問1}}\n次の英文を読み、設問に答えよ。\n\nThe immune system..."} rows={8}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent resize-y" />
          </div>

          {/* Add buttons */}
          {(!showAnswer || !showCommentary) && (
            <div className="flex gap-2 flex-wrap">
              {!showAnswer && (
                <button type="button" onClick={() => setShowAnswer(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-emerald-300 text-emerald-600 text-xs font-600 hover:bg-emerald-50 hover:border-emerald-400 transition">
                  <i className="fa-solid fa-plus text-[10px]" />解答を追加
                </button>
              )}
              {!showCommentary && (
                <button type="button" onClick={() => setShowCommentary(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-sky-300 text-sky-600 text-xs font-600 hover:bg-sky-50 hover:border-sky-400 transition">
                  <i className="fa-solid fa-plus text-[10px]" />解説を追加
                </button>
              )}
            </div>
          )}

          {/* Answer */}
          {showAnswer && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide">
                  <i className="fa-solid fa-check-circle text-emerald-500 mr-1" />解答
                </label>
                <button type="button" onClick={() => setShowAnswer(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 transition flex items-center gap-1">
                  <i className="fa-solid fa-xmark" />折りたたむ
                </button>
              </div>
              <MarkupToolbar taRef={answerRef} value={question.answerText}
                onChange={(v) => onChange("answerText", v)} onShowReference={onShowMarkupRef} />
              <textarea ref={answerRef} value={question.answerText}
                onChange={(e) => onChange("answerText", e.target.value)}
                placeholder="解答を入力..." rows={4}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent resize-y" />
            </div>
          )}

          {/* Commentary */}
          {showCommentary && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-600 text-slate-500 uppercase tracking-wide">
                  <i className="fa-solid fa-lightbulb text-[#0891b2] mr-1" />解説
                </label>
                <button type="button" onClick={() => setShowCommentary(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 transition flex items-center gap-1">
                  <i className="fa-solid fa-xmark" />折りたたむ
                </button>
              </div>
              <MarkupToolbar taRef={commentaryRef} value={question.commentaryText}
                onChange={(v) => onChange("commentaryText", v)} onShowReference={onShowMarkupRef} />
              <textarea ref={commentaryRef} value={question.commentaryText}
                onChange={(e) => onChange("commentaryText", e.target.value)}
                placeholder="解説を入力..." rows={4}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent resize-y" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
