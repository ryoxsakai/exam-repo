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

  /* ---- 汎用の並べ替えリスト（PC:ドラッグ / スマホ:タップ長押し） ----
     container 直下の itemSelector（既定 ".sort-item"）に一致する要素を、各要素内の
     ".grip" ハンドルからのドラッグ／タップ長押しで並べ替える。並べ替えが確定すると
     onReorder(idsInNewOrder)（idAttr、既定 "data-sort-id" の値の配列）を呼ぶので、
     呼び出し側で状態の更新・再描画・保存を行う（このヘルパー自身はDOM操作のみ）。
     お気に入りフォルダのドラッグ＆ドロップ（viewer.js）と同じ操作方式だが、階層移動が
     無いぶんシンプルな1階層のリスト専用。addEventListener は container に1回だけ
     登録すれば良い（子要素の再描画はイベント委任で自動的に効く）。 */
  function makeSortableList(container, opts) {
    opts = opts || {};
    var itemSel = opts.itemSelector || ".sort-item";
    var idAttr = opts.idAttr || "data-sort-id";
    var onReorder = opts.onReorder || function () {};
    var touchDragClass = opts.touchDragClass || "sortlist-dragging-touch";

    function items() { return $all(itemSel, container); }
    function idOf(n) { return n.getAttribute(idAttr); }

    function dropTarget(clientY) {
      var list = items();
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) {
          return { node: list[i], before: (clientY - r.top) < r.height / 2 };
        }
      }
      return null;
    }
    function clearIndicators() {
      items().forEach(function (n) { n.classList.remove("drag-over-top", "drag-over-bottom"); });
    }
    function updateIndicator(clientY) {
      clearIndicators();
      var t = dropTarget(clientY);
      if (t) t.node.classList.add(t.before ? "drag-over-top" : "drag-over-bottom");
      return t;
    }
    function commit(dragId, target) {
      clearIndicators();
      if (!target || idOf(target.node) === dragId) return;
      var order = items().map(idOf).filter(function (id) { return id !== dragId; });
      var refIdx = order.indexOf(idOf(target.node));
      var insertAt = target.before ? refIdx : refIdx + 1;
      order.splice(Math.max(0, insertAt), 0, dragId);
      onReorder(order);
    }

    // PC: ネイティブ Drag and Drop API（.grip からのみ開始）
    var dragId = null;
    container.addEventListener("dragstart", function (e) {
      var grip = e.target.closest && e.target.closest(".grip");
      var item = grip && grip.closest(itemSel);
      if (!item) { e.preventDefault(); return; }
      dragId = idOf(item);
      item.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", dragId); } catch (err) {}
      e.dataTransfer.effectAllowed = "move";
    });
    container.addEventListener("dragend", function () {
      items().forEach(function (n) { n.classList.remove("dragging"); });
      clearIndicators();
      dragId = null;
    });
    container.addEventListener("dragover", function (e) {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      updateIndicator(e.clientY);
    });
    container.addEventListener("drop", function (e) {
      if (!dragId) return;
      e.preventDefault();
      var target = dropTarget(e.clientY);
      var id = dragId;
      items().forEach(function (n) { n.classList.remove("dragging"); });
      dragId = null;
      commit(id, target);
    });

    // スマホ: グリップをタップ長押しでドラッグ開始（長押し判定中に指が動いたらスクロールとみなし中止）
    var touch = null;
    container.addEventListener("touchstart", function (e) {
      var grip = e.target.closest && e.target.closest(".grip");
      var item = grip && grip.closest(itemSel);
      if (!item) return;
      var t = e.touches[0];
      if (touch && touch.timer) clearTimeout(touch.timer);
      touch = {
        item: item, id: idOf(item), startX: t.clientX, startY: t.clientY, dragging: false,
        timer: setTimeout(function () { beginTouchDrag(t.clientX, t.clientY); }, 450)
      };
    }, { passive: true });
    container.addEventListener("touchmove", function (e) {
      if (!touch) return;
      var t = e.touches[0];
      if (!touch.dragging) {
        var dx = t.clientX - touch.startX, dy = t.clientY - touch.startY;
        if (Math.sqrt(dx * dx + dy * dy) > 10) { clearTimeout(touch.timer); touch = null; }
        return;
      }
      e.preventDefault();
      moveGhost(t.clientX, t.clientY);
      updateIndicator(t.clientY);
    }, { passive: false });
    container.addEventListener("touchend", function (e) {
      if (!touch) return;
      clearTimeout(touch.timer);
      if (touch.dragging) {
        e.preventDefault();
        var t = (e.changedTouches && e.changedTouches[0]) || touch;
        var target = dropTarget(t.clientY);
        var id = touch.id;
        endTouchDrag(touch.item);
        commit(id, target);
      }
      touch = null;
    });
    container.addEventListener("touchcancel", function () {
      if (touch) {
        clearTimeout(touch.timer);
        if (touch.dragging) endTouchDrag(touch.item);
        touch = null;
      }
    });
    container.addEventListener("contextmenu", function (e) {
      if (touch && touch.dragging) e.preventDefault();
    });

    function beginTouchDrag(clientX, clientY) {
      if (!touch) return;
      touch.dragging = true;
      touch.item.classList.add("dragging");
      document.body.classList.add(touchDragClass);
      var ghost = create("div", { id: "sortlist-drag-ghost", class: "sortlist-drag-ghost" }, touch.item.innerHTML);
      document.body.appendChild(ghost);
      moveGhost(clientX, clientY);
    }
    function moveGhost(clientX, clientY) {
      var ghost = el("sortlist-drag-ghost");
      if (ghost) { ghost.style.left = clientX + "px"; ghost.style.top = clientY + "px"; }
    }
    function endTouchDrag(item) {
      item.classList.remove("dragging");
      document.body.classList.remove(touchDragClass);
      clearIndicators();
      var ghost = el("sortlist-drag-ghost");
      if (ghost) ghost.remove();
    }
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
    makeSortableList: makeSortableList,
    applyDomainLinks: applyDomainLinks
  };
})(window);
