/* =====================================================================
   onboarding.js — 画面要素をハイライトしながら順に案内するガイドツアー。
   Onboarding.start(steps) で開始。steps は [{ target, title, text }, ...]
   （target はCSSセレクタ文字列、またはDOM要素）。特定のページに依存しない
   汎用エンジンで、ステップの内容は呼び出し側（viewer.js 等）が用意する。
   ===================================================================== */
(function (global) {
  "use strict";
  var el = UI.el, create = UI.create, esc = UI.escapeHtml;

  var state = null; // { steps, idx, overlay, spot, tip }

  function start(steps) {
    if (!steps || !steps.length) return;
    stop();
    var overlay = create("div", { class: "onboarding-overlay" });
    var spot = create("div", { class: "onboarding-spot" });
    var tip = create("div", { class: "onboarding-tip" });
    overlay.appendChild(spot);
    overlay.appendChild(tip);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    state = { steps: steps, idx: 0, overlay: overlay, spot: spot, tip: tip };

    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) stop();
    });
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onReposition);

    render();
  }

  function stop() {
    if (!state) return;
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", onReposition);
    state.overlay.remove();
    document.body.style.overflow = "";
    state = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") stop();
  }
  function onReposition() {
    if (state) render();
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target !== "string") return target;
    return el(target) || document.querySelector(target);
  }

  function render() {
    var step = state.steps[state.idx];
    var target = resolveTarget(step.target);
    if (target && target.scrollIntoView) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    var rect = target
      ? target.getBoundingClientRect()
      : { top: window.innerHeight / 2 - 20, left: window.innerWidth / 2 - 20, width: 40, height: 40, bottom: window.innerHeight / 2 + 20 };

    var pad = 6;
    state.spot.style.top = Math.max(0, rect.top - pad) + "px";
    state.spot.style.left = Math.max(0, rect.left - pad) + "px";
    state.spot.style.width = (rect.width + pad * 2) + "px";
    state.spot.style.height = (rect.height + pad * 2) + "px";

    var last = state.idx === state.steps.length - 1;
    state.tip.innerHTML =
      '<div class="onboarding-tip-head">' +
        '<span class="onboarding-tip-step">' + (state.idx + 1) + " / " + state.steps.length + "</span>" +
        '<button type="button" class="onboarding-tip-close" aria-label="閉じる"><i class="fa-solid fa-xmark"></i></button>' +
      "</div>" +
      '<h3 class="onboarding-tip-title">' + esc(step.title) + "</h3>" +
      '<p class="onboarding-tip-text">' + esc(step.text) + "</p>" +
      '<div class="onboarding-tip-foot">' +
        '<button type="button" class="btn ghost sm onboarding-skip">スキップ</button>' +
        '<span class="spacer"></span>' +
        (state.idx > 0 ? '<button type="button" class="btn ghost sm onboarding-back">戻る</button>' : "") +
        '<button type="button" class="btn primary sm onboarding-next">' + (last ? "はじめる" : "次へ") + "</button>" +
      "</div>";

    // innerHTML 反映直後に offsetWidth/Height を読むと同期的にレイアウトされるため、
    // その場でツールチップのサイズを取得して位置決めできる（requestAnimationFrame不要）。
    positionTip(rect);

    state.tip.querySelector(".onboarding-tip-close").addEventListener("click", stop);
    state.tip.querySelector(".onboarding-skip").addEventListener("click", stop);
    var backBtn = state.tip.querySelector(".onboarding-back");
    if (backBtn) backBtn.addEventListener("click", function () { state.idx--; render(); });
    state.tip.querySelector(".onboarding-next").addEventListener("click", function () {
      if (last) { stop(); return; }
      state.idx++; render();
    });
  }

  function positionTip(rect) {
    var tip = state.tip;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var top = rect.bottom + 14;
    if (top + th > vh - 12) top = Math.max(12, rect.top - th - 14);
    var left = rect.left;
    if (left + tw > vw - 12) left = vw - tw - 12;
    if (left < 12) left = 12;
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }

  global.Onboarding = { start: start, stop: stop };
})(window);
