"use client";

import React from "react";

export interface ExamCardData {
  exam_id: number;
  university_name: string;
  year: number;
  schedule: string;
  question_count: number;
  total_occurrences?: number;
  matching_questions?: string;
  searchWord?: string;
}

interface ExamCardProps {
  exam: ExamCardData;
  onSelect: (examId: number) => void;
  selected?: boolean;
}

const SCHEDULE_COLORS: Record<string, string> = {
  前期: "bg-blue-100 text-blue-700 border-blue-200",
  後期: "bg-purple-100 text-purple-700 border-purple-200",
  推薦: "bg-emerald-100 text-emerald-700 border-emerald-200",
  AO: "bg-amber-100 text-amber-700 border-amber-200",
  その他: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function ExamCard({ exam, onSelect, selected }: ExamCardProps) {
  const scheduleColor =
    SCHEDULE_COLORS[exam.schedule] || "bg-slate-100 text-slate-600 border-slate-200";

  const matchingNums = exam.matching_questions
    ? exam.matching_questions.split(",").map((n) => n.trim()).filter(Boolean)
    : [];

  return (
    <button
      onClick={() => onSelect(exam.exam_id)}
      className={`
        w-full text-left rounded-xl border transition-all duration-200
        ${
          selected
            ? "border-[#6b46c1] bg-purple-50 shadow-md ring-2 ring-[#6b46c1]/20"
            : "border-slate-200 bg-white hover:border-[#6b46c1]/40 hover:shadow-md"
        }
        p-4 group
      `}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: university + year info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-700 text-[#1e3a5f] text-base leading-tight truncate">
              {exam.university_name}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-600 border ${scheduleColor}`}
            >
              {exam.schedule}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-sm text-slate-500 flex items-center gap-1">
              <i className="fa-regular fa-calendar text-[#0891b2] text-xs" />
              {exam.year}年度
            </span>
            <span className="text-sm text-slate-400 flex items-center gap-1">
              <i className="fa-regular fa-file-lines text-slate-400 text-xs" />
              大問 {exam.question_count} 問
            </span>
          </div>

          {/* Matching questions indicator */}
          {exam.searchWord && matchingNums.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-slate-400">該当大問:</span>
              {matchingNums.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-xs font-600 border border-purple-200"
                >
                  問{n}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: occurrence count badge */}
        {exam.searchWord && exam.total_occurrences !== undefined && (
          <div className="flex-shrink-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#1e3a5f] to-[#6b46c1] text-white rounded-lg px-3 py-2 min-w-[56px]">
            <span className="text-lg font-800 leading-none">{exam.total_occurrences}</span>
            <span className="text-[10px] font-500 opacity-80 mt-0.5">件</span>
          </div>
        )}

        {/* Arrow icon */}
        {!exam.searchWord && (
          <i
            className={`fa-solid fa-chevron-right text-slate-300 group-hover:text-[#6b46c1] transition text-sm mt-0.5 ${
              selected ? "text-[#6b46c1]" : ""
            }`}
          />
        )}
      </div>
    </button>
  );
}
