"use client";

import React, { useState, useEffect } from "react";
import { getConfig } from "@/lib/api";

interface SearchBarProps {
  onSearch: (params: SearchParams) => void;
  loading?: boolean;
}

export interface SearchParams {
  universityName: string;
  year: string;
  schedule: string;
  word: string;
}

export const DEFAULT_SCHEDULES = ["前期", "後期", "一般前期", "一般後期", "推薦", "AO", "その他"];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = ["", ...Array.from({ length: 30 }, (_, i) => String(CURRENT_YEAR - i))];

export default function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [params, setParams] = useState<SearchParams>({
    universityName: "",
    year: "",
    schedule: "",
    word: "",
  });
  const [scheduleOptions, setScheduleOptions] = useState<string[]>(DEFAULT_SCHEDULES);

  useEffect(() => {
    getConfig()
      .then((cfg) => setScheduleOptions(cfg.schedules))
      .catch(() => { /* keep defaults if Worker not configured */ });
  }, []);

  const handleChange = (field: keyof SearchParams, value: string) => {
    setParams((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(params);
  };

  const handleClear = () => {
    const cleared: SearchParams = { universityName: "", year: "", schedule: "", word: "" };
    setParams(cleared);
    onSearch(cleared);
  };

  const hasFilters = Object.values(params).some((v) => v !== "");

  const inputClass =
    "w-full h-10 px-3.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A] placeholder:text-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20 focus:border-[#4F46E5] transition";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6 space-y-5"
    >
      {/* Top row: university + year + schedule */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* University name */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-600 text-[#64748B]">
            大学名
          </label>
          <input
            type="text"
            value={params.universityName}
            onChange={(e) => handleChange("universityName", e.target.value)}
            placeholder="例: 東京大学"
            className={inputClass}
          />
        </div>

        {/* Year */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-600 text-[#64748B]">
            年度
          </label>
          <select
            value={params.year}
            onChange={(e) => handleChange("year", e.target.value)}
            className={inputClass}
          >
            <option value="">すべての年度</option>
            {YEAR_OPTIONS.filter((y) => y !== "").map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
        </div>

        {/* Schedule */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-600 text-[#64748B]">
            試験区分
          </label>
          <select
            value={params.schedule}
            onChange={(e) => handleChange("schedule", e.target.value)}
            className={inputClass}
          >
            <option value="">すべての区分</option>
            {scheduleOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Word search row */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-600 text-[#64748B]">
          キーワード検索
        </label>
        <div className="relative">
          <input
            type="text"
            value={params.word}
            onChange={(e) => handleChange("word", e.target.value)}
            placeholder=""
            className={`${inputClass} pl-10`}
          />
          <i className="fa-regular fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-[#CBD5E1] text-sm" />
        </div>
        <p className="text-xs text-[#94A3B8]">
          単語を入力すると、その単語を含む過去問が出現頻度順に表示されます
        </p>
      </div>

      {/* Clear button row */}
      {hasFilters && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#64748B] transition"
          >
            <i className="fa-regular fa-xmark" />
            クリア
          </button>
        </div>
      )}

      {/* Search button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 rounded-xl text-white font-600 text-sm bg-gradient-to-r from-[#4F46E5] via-[#7C3AED] to-[#22D3EE] hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <i className="fa-solid fa-spinner fa-spin" />
        ) : (
          <i className="fa-regular fa-magnifying-glass" />
        )}
        検索
      </button>
    </form>
  );
}
