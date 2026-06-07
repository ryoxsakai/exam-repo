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
    <div className="print-area bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] px-6 py-4 no-print">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-white text-xl font-700 leading-tight">
              {exam.university_name}
            </h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-blue-200 text-sm">
                <i className="fa-regular fa-calendar mr-1" />
                {exam.year}年度
              </span>
              <span className="text-blue-200 text-sm">
                <i className="fa-solid fa-tag mr-1" />
                {exam.schedule}
              </span>
              <span className="text-blue-200 text-sm">
                <i className="fa-regular fa-file-lines mr-1" />
                大問 {sortedQuestions.length} 問
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {/* Toggle: show answers */}
            <label className="flex items-center gap-2 cursor-pointer bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition">
              <div
                onClick={() => setShowAnswers((v) => !v)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showAnswers ? "bg-emerald-400" : "bg-white/30"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
                    showAnswers ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </div>
              <span className="text-white text-xs font-500 whitespace-nowrap">
                {showAnswers ? "解答・解説も表示" : "問題のみ表示"}
              </span>
            </label>

            {/* Print button */}
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg text-sm font-500 transition"
              title="PDFとして印刷"
            >
              <i className="fa-solid fa-print" />
              <span className="hidden sm:inline">印刷</span>
            </button>
          </div>
        </div>
      </div>

      {/* Print-only header */}
      <div className="page-header hidden print:block px-8 py-4 border-b">
        <h1 className="text-2xl font-700 text-[#1e3a5f]">
          {exam.university_name} {exam.year}年度 {exam.schedule}
        </h1>
        {showAnswers && (
          <p className="text-sm text-slate-500 mt-1">解答・解説含む</p>
        )}
      </div>

      {/* Tabs for 大問 */}
      {sortedQuestions.length > 1 && (
        <div className="border-b border-slate-200 bg-slate-50 no-print">
          <div className="flex overflow-x-auto px-4">
            {sortedQuestions.map((q, idx) => (
              <button
                key={q.id}
                onClick={() => setActiveTab(idx)}
                className={`
                  flex-shrink-0 px-4 py-3 text-sm font-500 border-b-2 transition-all
                  ${
                    activeTab === idx
                      ? "border-[#6b46c1] text-[#1e3a5f] font-700"
                      : "border-transparent text-slate-500 hover:text-[#1e3a5f] hover:border-slate-300"
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
        <div className="px-6 py-6 space-y-6 exam-card">
          {/* Problem text */}
          <div className="question-block">
            <ParsedText
              text={activeQuestion.problem_text}
              className="leading-relaxed"
            />
          </div>

          {/* Answer / commentary (toggled) */}
          {showAnswers && (
            <div className="space-y-4 pt-2">
              {activeQuestion.answer_text && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <i className="fa-solid fa-check-circle text-emerald-600" />
                    <h3 className="font-700 text-emerald-800 text-sm uppercase tracking-wide">
                      解答
                    </h3>
                  </div>
                  <ParsedText
                    text={activeQuestion.answer_text}
                    className="text-emerald-900"
                  />
                </div>
              )}

              {activeQuestion.commentary_text && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <i className="fa-solid fa-lightbulb text-[#0891b2]" />
                    <h3 className="font-700 text-[#1e3a5f] text-sm uppercase tracking-wide">
                      解説
                    </h3>
                  </div>
                  <ParsedText
                    text={activeQuestion.commentary_text}
                    className="text-blue-900"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-12 text-center text-slate-400">
          <i className="fa-regular fa-file-lines text-4xl mb-3 block" />
          <p>問題が登録されていません</p>
        </div>
      )}

      {/* Print: show all questions */}
      <div className="hidden print:block px-8 py-4 space-y-8">
        {sortedQuestions.map((q) => (
          <div key={q.id} className="question-block">
            <h2 className="text-lg font-700 text-[#1e3a5f] mb-4 border-b pb-2">
              大問 {q.question_number}
            </h2>
            <ParsedText text={q.problem_text} />
            {showAnswers && q.answer_text && (
              <div className="mt-4 p-4 border border-emerald-200 rounded-lg">
                <h3 className="font-700 text-emerald-700 mb-2">解答</h3>
                <ParsedText text={q.answer_text} />
              </div>
            )}
            {showAnswers && q.commentary_text && (
              <div className="mt-4 p-4 border border-blue-200 rounded-lg">
                <h3 className="font-700 text-blue-700 mb-2">解説</h3>
                <ParsedText text={q.commentary_text} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
