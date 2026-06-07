"use client";

import React from "react";
import { parseTextFull } from "@/lib/parser";

interface ParsedTextProps {
  text: string;
  className?: string;
}

export default function ParsedText({ text, className }: ParsedTextProps) {
  const { elements, footnotes } = parseTextFull(text);

  return (
    <div className={`parsed-text ${className || ""}`}>
      {elements}
      {footnotes.length > 0 && (
        <div className="footnote-section">
          <ol>
            {footnotes.map((fn) => (
              <li key={fn.index}>
                <span className="footnote-number">*{fn.index}</span>
                <span>
                  <strong>{fn.word}</strong>: {fn.translation}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
