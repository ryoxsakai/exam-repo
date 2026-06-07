"use client";

import { useEffect } from "react";
import { getConfig } from "@/lib/api";

const LS_KEY = "cf_markup_css";

export function applyMarkupCss(css: string) {
  let el = document.getElementById("custom-markup-css") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "custom-markup-css";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export default function CustomMarkupCss() {
  useEffect(() => {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) applyMarkupCss(cached);

    getConfig().then((cfg) => {
      if (cfg.markup_css) {
        applyMarkupCss(cfg.markup_css);
        try { localStorage.setItem(LS_KEY, cfg.markup_css); } catch { /* ignore */ }
      }
    }).catch(() => {});
  }, []);

  return null;
}
