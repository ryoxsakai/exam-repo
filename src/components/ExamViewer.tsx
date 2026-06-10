"use client";

import React, { useState, useCallback } from "react";
import ParsedText from "./ParsedText";

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
        {showAnswers && (
          <p className="text-sm text-[#64748B] mt-1">解答・解説含む</p>
        )}
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

      {/* Question content */}
      {activeQuestion ? (
        <div className="px-7 py-7 space-y-6 exam-card">
          {/* Problem text */}
          <div className="question-block">
            <ParsedText
              text={activeQuestion.problem_text}
              className="leading-relaxed"
            />
          </div>

          {/* Answer / commentary (toggled) */}
          {showAnswers && (
            <div className="space-y-4 pt-1">
              {activeQuestion.answer_text && (
                <div className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <i className="fa-regular fa-circle-check text-[#10B981] text-sm" />
                    <span className="text-xs font-700 text-[#10B981] tracking-wide">解答</span>
                  </div>
                  <ParsedText
                    text={activeQuestion.answer_text}

                    className="text-[#065F46]"
                  />
                </div>
              )}

              {activeQuestion.commentary_text && (
                <div className="rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <i className="fa-regular fa-lightbulb text-[#4F46E5] text-sm" />
                    <span className="text-xs font-700 text-[#4F46E5] tracking-wide">解説</span>
                  </div>
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
        <div className="px-6 py-12 text-center text-[#94A3B8]">
          <i className="fa-regular fa-file-lines text-4xl mb-3 block opacity-30" />
          <p className="text-sm">問題が登録されていません</p>
        </div>
      )}

      {/* Print: show all questions */}
      <div className="hidden print:block px-8 py-4 space-y-8">
        {sortedQuestions.map((q) => (
          <div key={q.id} className="question-block">
            <h2 className="text-lg font-700 text-[#0F172A] mb-4 border-b border-[#E2E8F0] pb-2">
              大問 {q.question_number}
            </h2>
            <ParsedText text={q.problem_text} />
            {showAnswers && q.answer_text && (
              <div className="mt-4 p-4 border border-[#BBF7D0] rounded-xl">
                <h3 className="font-700 text-[#10B981] mb-2 text-sm">解答</h3>
                <ParsedText text={q.answer_text} />
              </div>
            )}
            {showAnswers && q.commentary_text && (
              <div className="mt-4 p-4 border border-[#BFDBFE] rounded-xl">
                <h3 className="font-700 text-[#4F46E5] mb-2 text-sm">解説</h3>
                <ParsedText text={q.commentary_text} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
