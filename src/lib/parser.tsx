import React from "react";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
export interface ParsedResult {
  elements: React.ReactNode[];
  footnotes: FootnoteEntry[];
}

interface FootnoteEntry {
  index: number;
  word: string;
  translation: string;
}

// ----------------------------------------------------------------
// Abbreviation spacing fix
// ----------------------------------------------------------------
// Titles/abbreviations like "Dr.", "Mr.", "Mt." are often followed by a
// full-width space (U+3000) or multiple spaces in the source data, which
// renders as an unwanted wide gap after the period. Collapse that gap into a
// single non-breaking space so the abbreviation stays attached to the
// following word with normal half-width spacing.
const ABBREVIATIONS = [
  "Dr", "Mr", "Mrs", "Ms", "Mt", "St", "Prof", "Fig", "No", "Jr", "Sr",
  "Co", "Inc", "Ltd", "Rev", "Hon", "Gen", "Capt", "Sgt", "Col",
];
const ABBREV_RE = new RegExp(
  `\\b(${ABBREVIATIONS.join("|")})\\.[\\s\\u3000]+`,
  "g"
);
function normalizeAbbreviationSpaces(line: string): string {
  // Replace with the abbreviation period + a single non-breaking space so the
  // title stays attached to the following word at normal half-width spacing.
  return line.replace(ABBREV_RE, "$1. ");
}

// ----------------------------------------------------------------
// Main parser function
// ----------------------------------------------------------------
export function parseText(text: string): ParsedResult {
  const footnotes: FootnoteEntry[] = [];
  let footnoteCounter = 0;

  // Split text into lines first so we can handle block-level elements
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  let lineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeAbbreviationSpaces(lines[i]);

    // Blank line → paragraph break
    if (line.trim() === "") {
      elements.push(<br key={`br-${lineIdx++}`} />);
      continue;
    }

    // `----` → styled HR
    if (line.trim() === "----") {
      elements.push(<hr key={`hr-${lineIdx++}`} className="exam-hr" />);
      continue;
    }

    // Parse inline elements for the line
    const inlineElements = parseInline(line, footnotes, footnoteCounter);
    footnoteCounter = footnotes.length;

    elements.push(
      <span key={`line-${lineIdx++}`} style={{ display: "block" }}>
        {inlineElements}
      </span>
    );
  }

  return { elements, footnotes };
}

// ----------------------------------------------------------------
// Inline parser
// ----------------------------------------------------------------
function parseInline(
  text: string,
  footnotes: FootnoteEntry[],
  footnoteStartIdx: number
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  const key = () => `inline-${footnoteStartIdx}-${keyIdx++}`;

  while (remaining.length > 0) {
    // ── {{問N}} → question number badge with separator lines ──────
    const questionMatch = remaining.match(/^\{\{([^}]+)\}\}/);
    if (questionMatch) {
      result.push(
        <span key={key()} className="question-block-header" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="question-badge">{questionMatch[1]}</span>
        </span>
      );
      remaining = remaining.slice(questionMatch[0].length);
      continue;
    }

    // ── [[N]] or [[A]] → blank badge ─────────────────────────────
    const blankMatch = remaining.match(/^\[\[([^\]]+)\]\]/);
    if (blankMatch) {
      result.push(
        <span key={key()} className="blank-badge">
          {blankMatch[1]}
        </span>
      );
      remaining = remaining.slice(blankMatch[0].length);
      continue;
    }

    // ── ##word::translation## → footnote ─────────────────────────
    const footnoteMatch = remaining.match(/^##([^:]+)::([^#]+)##/);
    if (footnoteMatch) {
      const word = footnoteMatch[1];
      const translation = footnoteMatch[2];
      const idx = footnotes.length + 1;
      footnotes.push({ index: idx, word, translation });
      result.push(
        <span key={key()} title={`${word}: ${translation}`}>
          {word}
          <sup className="footnote-number">*{idx}</sup>
        </span>
      );
      remaining = remaining.slice(footnoteMatch[0].length);
      continue;
    }

    // ── ==text==:color → highlight with color variant ─────────────
    const highlightColorMatch = remaining.match(/^==([^=]+)==:(\w+)/);
    if (highlightColorMatch) {
      const hlText = highlightColorMatch[1];
      const color = highlightColorMatch[2];
      const validColors = ["yellow", "blue", "red", "purple", "pink", "green", "aqua"];
      const colorClass = validColors.includes(color)
        ? `highlight-${color}`
        : "highlight-yellow";
      result.push(
        <mark key={key()} className={colorClass}>
          {parseInline(hlText, footnotes, footnotes.length)}
        </mark>
      );
      remaining = remaining.slice(highlightColorMatch[0].length);
      continue;
    }

    // ── ==text== → yellow highlight ──────────────────────────────
    const highlightMatch = remaining.match(/^==([^=]+)==(?!:\w)/);
    if (highlightMatch) {
      result.push(
        <mark key={key()} className="highlight-yellow">
          {parseInline(highlightMatch[1], footnotes, footnotes.length)}
        </mark>
      );
      remaining = remaining.slice(highlightMatch[0].length);
      continue;
    }

    // ── __text__ → underline ──────────────────────────────────────
    const underlineMatch = remaining.match(/^__([^_]+)__/);
    if (underlineMatch) {
      result.push(
        <u key={key()}>
          {parseInline(underlineMatch[1], footnotes, footnotes.length)}
        </u>
      );
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    // ── ~~N~~ → subscript ─────────────────────────────────────────
    const subMatch = remaining.match(/^~~([^~]+)~~/);
    if (subMatch) {
      result.push(<sub key={key()}>{subMatch[1]}</sub>);
      remaining = remaining.slice(subMatch[0].length);
      continue;
    }

    // ── ^^text^^ → superscript ────────────────────────────────────
    const supMatch = remaining.match(/^\^\^([^^]+)\^\^/);
    if (supMatch) {
      result.push(<sup key={key()}>{supMatch[1]}</sup>);
      remaining = remaining.slice(supMatch[0].length);
      continue;
    }

    // ── ((a)) or ((1)) → inline answer-choice reference ──────────
    const choiceMatch = remaining.match(/^\(\(([^)]+)\)\)/);
    if (choiceMatch) {
      const label = choiceMatch[1];
      result.push(
        <span key={key()} className="choice-inline">
          {label}
        </span>
      );
      remaining = remaining.slice(choiceMatch[0].length);
      continue;
    }

    // ── Consume one character as plain text ───────────────────────
    // Accumulate plain text characters greedily
    let plainEnd = 1;
    while (plainEnd < remaining.length) {
      const c = remaining[plainEnd];
      // Stop at potential markup starts
      if (
        c === "{" ||
        c === "[" ||
        c === "#" ||
        c === "=" ||
        c === "_" ||
        c === "~" ||
        c === "^" ||
        c === "("
      ) {
        break;
      }
      plainEnd++;
    }
    result.push(remaining.slice(0, plainEnd));
    remaining = remaining.slice(plainEnd);
  }

  return result;
}

// ----------------------------------------------------------------
// Full render function: parse + render footnote list
// ----------------------------------------------------------------
export function renderParsedText(text: string): React.ReactNode {
  const { elements, footnotes } = parseText(text);

  return (
    <>
      <div className="parsed-text">{elements}</div>
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
    </>
  );
}

// ----------------------------------------------------------------
// Answer choice line renderer (handles ((A)) at start of line)
// ----------------------------------------------------------------
export function parseAnswerChoiceLine(
  line: string,
  footnotes: FootnoteEntry[]
): React.ReactNode {
  const choiceMatch = line.match(/^\(\(([^)]+)\)\)\s*([\s\S]*)/);
  if (choiceMatch) {
    const label = choiceMatch[1];
    const rest = choiceMatch[2];
    return (
      <span className="answer-choice">
        <span className="answer-choice-label">{label}</span>
        <span className="answer-choice-text">
          {rest ? parseInline(rest, footnotes, footnotes.length) : null}
        </span>
      </span>
    );
  }
  return null;
}

// ----------------------------------------------------------------
// Enhanced parse that handles ((A)) text... as full-line choices
// ----------------------------------------------------------------
export function parseTextFull(text: string): ParsedResult {
  const footnotes: FootnoteEntry[] = [];

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  let lineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeAbbreviationSpaces(lines[i]);
    const k = `l${lineIdx++}`;

    // Blank line → spacer
    if (line.trim() === "") {
      elements.push(<br key={k} />);
      continue;
    }

    // `----` → styled HR
    if (line.trim() === "----") {
      elements.push(<hr key={k} className="exam-hr" />);
      continue;
    }

    // {{問N}} at start of line → question badge inline with rest of text
    if (/^\{\{[^}]+\}\}/.test(line.trim())) {
      const qMatch = line.trim().match(/^\{\{([^}]+)\}\}/);
      if (qMatch) {
        const rest = line.trim().slice(qMatch[0].length).trim();
        elements.push(
          <div key={k} className="question-block-header">
            <span className="question-badge">{qMatch[1]}</span>
            {rest && <span className="question-block-text">{parseInline(rest, footnotes, footnotes.length)}</span>}
          </div>
        );
        continue;
      }
    }

    // ((A)) text... → block answer-choice line.
    // Only treat the line as a block choice when the "((...))" at the start is
    // followed by whitespace or is the whole line. If it is immediately
    // followed by other content (e.g. "((1))〜((5))より選びなさい。"), fall
    // through so the "(())" tokens render as compact inline references.
    const choiceMatch = line.match(/^(\s*)\(\(([^)]+)\)\)(\s[\s\S]*|\s*)$/);
    if (choiceMatch) {
      const label = choiceMatch[2];
      const rest = choiceMatch[3].trimStart();
      elements.push(
        <span key={k} className="answer-choice">
          <span className="answer-choice-label">{label}</span>
          <span className="answer-choice-text">
            {rest ? parseInline(rest, footnotes, footnotes.length) : null}
          </span>
        </span>
      );
      continue;
    }

    // Regular line with inline markup
    const inlineElements = parseInline(line, footnotes, footnotes.length);
    elements.push(
      <span key={k} style={{ display: "block" }}>
        {inlineElements}
      </span>
    );
  }

  return { elements, footnotes };
}
