"use client";

import React, { useState, useCallback, useEffect } from "react";
import ParsedText from "./ParsedText";

// Print section settings are shared across every exam/question and persisted
// to localStorage so the user's choice sticks between visits.
const SECTION_LS_KEY = "exam_print_sections_v1";

type SectionKey = "problem" | "answer" | "commentary";

type SectionSettings = Record<SectionKey, boolean>;

const DEFAULT_SECTIONS: SectionSettings = {
  problem: true,
  answer: true,
  commentary: true,
};

interface SectionTitleProps {
  sectionKey: SectionKey;
  label: string;
  icon: string;
  colorClass: string;
  checked: boolean;
  onToggle: (key: SectionKey) => void;
}

// Section title with a print checkbox next to it (screen-only).
function SectionTitle({
  sectionKey,
  label,
  icon,
  colorClass,
  checked,
  onToggle,
}: SectionTitleProps) {
  return (
    <div className="flex items-center gap-2 mb-2 no-print">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(sectionKey)}
          className="w-4 h-4 rounded border-[#CBD5E1] cursor-pointer accent-[#4F46E5]"
        />
        <i className={`${icon} text-sm ${colorClass}`} />
        <span className={`text-xs font-700 tracking-wide ${colorClass}`}>
          {label}
        </span>
      </label>
      <span className="text-[10px] text-[#94A3B8]">
        {checked ? "印刷する" : "印刷しない"}
      </span>
    </div>
  );
}

export interface QuestionData {
  id: number;
  exam_id: number;
  question_number: number;
  problem_text: string;
  answer_text: string;
  commentary_text: string;
}

export interface ExamViewerData {
  id: number;
  university_name: string;
  year: number;
  schedule: string;
  questions: QuestionData[];
}

interface ExamViewerProps {
  exam: ExamViewerData;
  highlightWord?: string;
}

export default function ExamViewer({ exam, highlightWord }: ExamViewerProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [showAnswers, setShowAnswers] = useState(false);
  const [printSections, setPrintSections] =
    useState<SectionSettings>(DEFAULT_SECTIONS);

  // Load shared print-section settings from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SECTION_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SectionSettings>;
        setPrintSections({ ...DEFAULT_SECTIONS, ...parsed });
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const toggleSection = useCallback((key: SectionKey) => {
    setPrintSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(SECTION_LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const sortedQuestions = [...exam.questions].sort(
    (a, b) => a.question_number - b.question_number
  );

  const activeQuestion = sortedQuestions[activeTab];

  return (
    <div className="print-area bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#E2E8F0] no-print">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-700 text-[#0F172A] leading-tight">
              {exam.university_name}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              <span className="inline-flex items-center text-xs text-[#64748B] bg-[#F1F5F9] px-2.5 py-1 rounded-full">
                {exam.year}年度
              </span>
              <span className="inline-flex items-center text-xs text-[#64748B] bg-[#F1F5F9] px-2.5 py-1 rounded-full">
                {exam.schedule}
              </span>
              <span className="inline-flex items-center text-xs text-[#94A3B8] px-1">
                大問 {sortedQuestions.length} 問
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Toggle: show answers */}
            <label
              className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] transition select-none"
              onClick={() => setShowAnswers((v) => !v)}
            >
              <div
                className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${
                  showAnswers ? "bg-[#10B981]" : "bg-[#E2E8F0]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                    showAnswers ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </div>
              <span className="text-xs font-500 text-[#64748B] whitespace-nowrap">
                {showAnswers ? "解答表示中" : "問題のみ"}
              </span>
            </label>

            {/* Print button */}
            <button
              onClick={handlePrint}
              className="p-2 rounded-xl border border-[#E2E8F0] text-[#94A3B8] hover:bg-[#F8FAFC] hover:text-[#64748B] transition"
              title="PDFとして印刷"
            >
              <i className="fa-regular fa-print text-sm" />
            </button>
          </div>
        </div>
      </div>

      {/* Print-only header */}
      <div className="page-header hidden print:block px-8 py-4 border-b border-[#E2E8F0]">
        <h1 className="text-2xl font-700 text-[#0F172A]">
          {exam.university_name}　{exam.year}年度　{exam.schedule}
        </h1>
        {(() => {
          const labels = [
            printSections.problem && "問題",
            printSections.answer && "解答",
            printSections.commentary && "解説",
          ].filter(Boolean);
          return labels.length > 0 ? (
            <p className="text-sm text-[#64748B] mt-1">
              {labels.join("・")}
            </p>
          ) : null;
        })()}
      </div>

      {/* Tabs for 大問 */}
      {sortedQuestions.length > 1 && (
        <div className="border-b border-[#E2E8F0] no-print">
          <div className="flex overflow-x-auto px-6">
            {sortedQuestions.map((q, idx) => (
              <button
                key={q.id}
                onClick={() => setActiveTab(idx)}
                className={`
                  flex-shrink-0 px-4 py-3 text-sm transition-all border-b-2 -mb-px
                  ${
                    activeTab === idx
                      ? "border-[#4F46E5] text-[#4F46E5] font-600"
                      : "border-transparent text-[#64748B] hover:text-[#0F172A] font-500"
                  }
                `}
              >
                大問 {q.question_number}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Question content (screen only — print uses the dedicated block below) */}
      {activeQuestion ? (
        <div className="px-7 py-7 space-y-6 exam-card no-print">
          {/* Problem */}
          <div>
            <SectionTitle
              sectionKey="problem"
              label="問題"
              icon="fa-regular fa-file-lines"
              colorClass="text-[#4F46E5]"
              checked={printSections.problem}
              onToggle={toggleSection}
            />
            <div className="question-block">
              <ParsedText
                text={activeQuestion.problem_text}
                className="leading-relaxed"
              />
            </div>
          </div>

          {/* Answer */}
          {activeQuestion.answer_text && (
            <div>
              <SectionTitle
                sectionKey="answer"
                label="解答"
                icon="fa-regular fa-circle-check"
                colorClass="text-[#10B981]"
                checked={printSections.answer}
                onToggle={toggleSection}
              />
              {showAnswers && (
                <div className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] p-5">
                  <ParsedText
                    text={activeQuestion.answer_text}
                    className="text-[#065F46]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Commentary */}
          {activeQuestion.commentary_text && (
            <div>
              <SectionTitle
                sectionKey="commentary"
                label="解説"
                icon="fa-regular fa-lightbulb"
                colorClass="text-[#4F46E5]"
                checked={printSections.commentary}
                onToggle={toggleSection}
              />
              {showAnswers && (
                <div className="rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] p-5">
                  <ParsedText
                    text={activeQuestion.commentary_text}
                    className="text-[#1E40AF]"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-12 text-center text-[#94A3B8] no-print">
          <i className="fa-regular fa-file-lines text-4xl mb-3 block opacity-30" />
          <p className="text-sm">問題が登録されていません</p>
        </div>
      )}

      {/* Print: show all questions, only the checked sections */}
      <div className="hidden print:block px-8 py-4">
        {sortedQuestions.map((q, qIdx) => {
          // Build the list of sections to print for this question. Each entry
          // is separated from the next by an automatic "----" divider.
          const sections: React.ReactNode[] = [];

          if (printSections.problem && q.problem_text) {
            sections.push(
              <div key="problem" className="print-section">
                <ParsedText text={q.problem_text} />
              </div>
            );
          }
          if (printSections.answer && q.answer_text) {
            sections.push(
              <div key="answer" className="print-section">
                <h3 className="font-700 text-[#10B981] mb-2 text-sm">解答</h3>
                <ParsedText text={q.answer_text} />
              </div>
            );
          }
          if (printSections.commentary && q.commentary_text) {
            sections.push(
              <div key="commentary" className="print-section">
                <h3 className="font-700 text-[#4F46E5] mb-2 text-sm">解説</h3>
                <ParsedText text={q.commentary_text} />
              </div>
            );
          }

          if (sections.length === 0) return null;

          return (
            <React.Fragment key={q.id}>
              {/* Auto divider between 大問 sections */}
              {qIdx > 0 && <hr className="exam-hr" />}
              <div className="question-block">
                <h2 className="text-lg font-700 text-[#0F172A] mb-4 border-b border-[#E2E8F0] pb-2">
                  大問 {q.question_number}
                </h2>
                {sections.map((section, sIdx) => (
                  <React.Fragment key={sIdx}>
                    {/* Auto divider between sections within a 大問 */}
                    {sIdx > 0 && <hr className="exam-hr" />}
                    {section}
                  </React.Fragment>
                ))}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
