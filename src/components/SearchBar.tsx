"use client";

import React, { useState } from "react";

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

const SCHEDULE_OPTIONS = ["", "前期", "後期", "推薦", "AO", "その他"];
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = ["", ...Array.from({ length: 30 }, (_, i) => String(CURRENT_YEAR - i))];

export default function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [params, setParams] = useState<SearchParams>({
    universityName: "",
    year: "",
    schedule: "",
    word: "",
  });

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

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl shadow-md border border-slate-200 p-5 space-y-4"
    >
      {/* Top row: university + year + schedule */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* University name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-600 text-slate-500 tracking-wide uppercase">
            <i className="fa-solid fa-university mr-1 text-[#1e3a5f]" />
            大学名
          </label>
          <div className="relative">
            <input
              type="text"
              value={params.universityName}
              onChange={(e) => handleChange("universityName", e.target.value)}
              placeholder="例: 東京大学"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent transition"
            />
          </div>
        </div>

        {/* Year */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-600 text-slate-500 tracking-wide uppercase">
            <i className="fa-solid fa-calendar mr-1 text-[#0891b2]" />
            年度
          </label>
          <select
            value={params.year}
            onChange={(e) => handleChange("year", e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent transition"
          >
            <option value="">すべての年度</option>
            {YEAR_OPTIONS.filter((y) => y !== "").map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </div>

        {/* Schedule */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-600 text-slate-500 tracking-wide uppercase">
            <i className="fa-solid fa-clock mr-1 text-[#059669]" />
            試験区分
          </label>
          <select
            value={params.schedule}
            onChange={(e) => handleChange("schedule", e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent transition"
          >
            {SCHEDULE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "すべての区分" : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Word search row */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-600 text-slate-500 tracking-wide uppercase">
          <i className="fa-solid fa-magnifying-glass mr-1 text-[#6b46c1]" />
          キーワード検索
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={params.word}
              onChange={(e) => handleChange("word", e.target.value)}
              placeholder="例: measles、胸腺、T lymphocyte"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b46c1] focus:border-transparent transition"
            />
            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          単語を入力すると、その単語を含む過去問が出現頻度順に表示されます
        </p>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-600 bg-gradient-to-r from-[#1e3a5f] to-[#6b46c1] hover:opacity-90 transition disabled:opacity-50 shadow-md"
        >
          {loading ? (
            <i className="fa-solid fa-spinner fa-spin" />
          ) : (
            <i className="fa-solid fa-search" />
          )}
          検索する
        </button>

        {hasFilters && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-slate-500 text-sm font-500 bg-slate-100 hover:bg-slate-200 transition"
          >
            <i className="fa-solid fa-xmark" />
            クリア
          </button>
        )}
      </div>
    </form>
  );
}
