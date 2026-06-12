/* =====================================================================
   ui.js — 共通UIヘルパー（トースト / タブ / モーダル / DOM）
   ===================================================================== */
(function (global) {
  "use strict";

  function el(id) { return document.getElementById(id); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function create(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- トースト ---- */
  function toast(msg, kind) {
    var wrap = el("toast-wrap");
    if (!wrap) { wrap = create("div", { id: "toast-wrap", class: "toast-wrap" }); document.body.appendChild(wrap); }
    var icon = kind === "ok" ? "fa-circle-check" : kind === "err" ? "fa-circle-exclamation" : "fa-circle-info";
    var t = create("div", { class: "toast " + (kind || "") },
      '<i class="fa-solid ' + icon + '"></i><span>' + escapeHtml(msg) + "</span>");
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .3s, transform .3s";
      t.style.opacity = "0"; t.style.transform = "translateY(8px)";
      setTimeout(function () { t.remove(); }, 300);
    }, kind === "err" ? 4200 : 2600);
  }

  /* ---- モーダル ---- */
  function openModal(overlay) { overlay.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeModal(overlay) { overlay.classList.remove("open"); document.body.style.overflow = ""; }
  function wireModal(overlay) {
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) closeModal(overlay); });
    $all("[data-close]", overlay).forEach(function (b) {
      b.addEventListener("click", function () { closeModal(overlay); });
    });
  }

  /* ---- タブ群（横スクロール） ----
     defs: {id: {label, icon, badge?}}
     opts.page: "main"|"setting" … カスタムタブ名(Store)の解決に使用
     opts.iconOnly: true でアイコンのみ表示（名前は title 属性に）
     onChange(id) コールバック  */
  function buildTabs(opts) {
    var tabsEl = opts.tabsEl, order = opts.order, defs = opts.defs, active = opts.active, onChange = opts.onChange;
    tabsEl.innerHTML = "";
    order.forEach(function (id) {
      var def = defs[id]; if (!def) return;
      var label = (opts.page && global.Store && Store.getTabLabel)
        ? Store.getTabLabel(opts.page, id, def.label) : def.label;
      var inner = opts.iconOnly
        ? (def.icon ? '<i class="fa-solid ' + def.icon + '"></i>' : "<span>" + escapeHtml(label) + "</span>")
        : (def.icon ? '<i class="fa-solid ' + def.icon + '"></i>' : "") +
          "<span>" + escapeHtml(label) + "</span>" +
          (def.badge != null ? '<span class="tab-badge" data-badge="' + id + '">' + def.badge + "</span>" : "");
      var btn = create("button", {
        class: "tab" + (opts.iconOnly ? " icon-only" : "") + (id === active ? " active" : ""),
        "data-tab": id, title: label
      }, inner);
      btn.addEventListener("click", function () { setActiveTab(tabsEl, id); if (onChange) onChange(id); });
      tabsEl.appendChild(btn);
    });
  }
  function setActiveTab(tabsEl, id) {
    $all(".tab", tabsEl).forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-tab") === id); });
    // パネル切替（data-panel が tabs と同じ親レベルにある前提）
    $all("[data-panel]").forEach(function (p) { p.classList.toggle("active", p.getAttribute("data-panel") === id); });
    var act = $('.tab[data-tab="' + id + '"]', tabsEl);
    if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function setTabBadge(id, value) {
    var b = $('[data-badge="' + id + '"]');
    if (b) b.textContent = value;
  }

  /* ---- ナビリンクを独自ドメイン基準の絶対URLに（未設定なら相対のまま） ---- */
  function applyDomainLinks() {
    var base = (global.Store && Store.getBaseUrl) ? Store.getBaseUrl() : "";
    var home = el("nav-home"), settings = el("nav-settings");
    if (home) home.setAttribute("href", base ? base + "/" : "../");
    if (settings) settings.setAttribute("href", base ? base + "/setting/" : "setting/");
  }

  global.UI = {
    el: el, $: $, $all: $all, create: create, escapeHtml: escapeHtml,
    toast: toast, openModal: openModal, closeModal: closeModal, wireModal: wireModal,
    buildTabs: buildTabs, setActiveTab: setActiveTab, setTabBadge: setTabBadge,
    applyDomainLinks: applyDomainLinks
  };
})(window);
