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
  前期: "bg-[#EFF6FF] text-[#3B82F6]",
  後期: "bg-[#F5F3FF] text-[#7C3AED]",
  推薦: "bg-[#ECFDF5] text-[#059669]",
  AO: "bg-[#FFFBEB] text-[#D97706]",
  その他: "bg-[#F1F5F9] text-[#64748B]",
};

export default function ExamCard({ exam, onSelect, selected }: ExamCardProps) {
  const scheduleColor =
    SCHEDULE_COLORS[exam.schedule] || "bg-[#F1F5F9] text-[#64748B]";

  const matchingNums = exam.matching_questions
    ? exam.matching_questions.split(",").map((n) => n.trim()).filter(Boolean)
    : [];

  return (
    <button
      onClick={() => onSelect(exam.exam_id)}
      className={`
        w-full text-left rounded-2xl border transition-all duration-200
        ${
          selected
            ? "border-[#4F46E5] bg-[#4F46E5]/[0.03] shadow-[0_2px_8px_rgba(79,70,229,0.08)] ring-2 ring-[#4F46E5]/10"
            : "border-[#E2E8F0] bg-white hover:border-[#4F46E5]/30 hover:shadow-[0_2px_8px_rgba(79,70,229,0.08)]"
        }
        p-4 group
      `}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: university + year info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-700 text-[#0F172A] text-[15px] leading-tight truncate">
              {exam.university_name}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-600 ${scheduleColor}`}
            >
              {exam.schedule}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-[#64748B] flex items-center gap-1">
              <i className="fa-regular fa-calendar text-[#94A3B8] text-xs" />
              {exam.year}年度
            </span>
            <span className="text-xs text-[#94A3B8] flex items-center gap-1">
              <i className="fa-regular fa-file-lines text-[#94A3B8] text-xs" />
              大問 {exam.question_count} 問
            </span>
          </div>

          {/* Matching questions indicator */}
          {exam.searchWord && matchingNums.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-[#94A3B8]">該当大問:</span>
              {matchingNums.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#EEF2FF] text-[#4F46E5] text-xs font-600"
                >
                  問{n}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: occurrence count badge */}
        {exam.searchWord && exam.total_occurrences !== undefined && (
          <div className="flex-shrink-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] text-white rounded-xl px-3 py-2 min-w-[56px]">
            <span className="text-lg font-800 leading-none">{exam.total_occurrences}</span>
            <span className="text-[10px] font-500 opacity-80 mt-0.5">件</span>
          </div>
        )}

        {/* Arrow icon */}
        {!exam.searchWord && (
          <i
            className={`fa-solid fa-chevron-right text-[#CBD5E1] group-hover:text-[#4F46E5] transition text-sm mt-0.5 ${
              selected ? "text-[#4F46E5]" : ""
            }`}
          />
        )}
      </div>
    </button>
  );
}
