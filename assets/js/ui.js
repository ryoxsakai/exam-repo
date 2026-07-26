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
     opts.draggable: true で各タブに draggable 属性を付ける（UI.makeSortableList と
       組み合わせてタブバー上で直接ドラッグ並べ替えできるようにする。タブは再描画の
       たびに作り直されるため、属性はここで毎回付与する必要がある）
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
      var attrs = {
        class: "tab" + (opts.iconOnly ? " icon-only" : "") + (id === active ? " active" : ""),
        "data-tab": id, title: label
      };
      if (opts.draggable) attrs.draggable = "true";
      var btn = create("button", attrs, inner);
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
     container 直下の itemSelector（既定 ".sort-item"）に一致する要素を、ドラッグ／
     タップ長押しで並べ替える。並べ替えが確定すると onReorder(idsInNewOrder)（idAttr、
     既定 "data-sort-id" の値の配列）を呼ぶので、呼び出し側で状態の更新・再描画・保存を
     行う（このヘルパー自身はDOM操作のみ）。お気に入りフォルダのドラッグ＆ドロップ
     （viewer.js）と同じ操作方式だが、階層移動が無いぶんシンプルな1階層のリスト専用。
     addEventListener は container に1回だけ登録すれば良い（子要素を作り直しても
     イベント委任で自動的に効く）。

     opts:
       itemSelector … 並べ替え対象（既定 ".sort-item"）
       idAttr       … 並び順を表す属性名（既定 "data-sort-id"）
       handleSelector … ドラッグ開始を許可する掴み手（既定 ".grip"。null を渡すと
                        要素全体が掴み手になる＝タブバーのようにハンドルを置けない場合）
       horizontal   … true で左右方向の並べ替え（タブバー等）。既定は上下方向
       ghostHtml(item) … スマホ長押し時に指へ追従するゴーストの中身（既定は item.innerHTML）
       onReorder(ids)  … 並べ替え確定時のコールバック */
  function makeSortableList(container, opts) {
    opts = opts || {};
    var itemSel = opts.itemSelector || ".sort-item";
    var idAttr = opts.idAttr || "data-sort-id";
    var onReorder = opts.onReorder || function () {};
    var touchDragClass = opts.touchDragClass || "sortlist-dragging-touch";
    // handleSelector を明示的に null にした場合は「要素全体が掴み手」。未指定なら ".grip"。
    var handleSel = opts.handleSelector === undefined ? ".grip" : opts.handleSelector;
    var horizontal = !!opts.horizontal;
    var ghostHtml = opts.ghostHtml || function (item) { return item.innerHTML; };

    function items() { return $all(itemSel, container); }
    function idOf(n) { return n.getAttribute(idAttr); }

    // イベントの発生源から、ドラッグ対象の要素を解決する（掴み手の指定があればその中のみ許可）
    function itemFromEvent(e) {
      var t = e.target;
      if (!t || !t.closest) return null;
      if (handleSel) {
        var h = t.closest(handleSel);
        return h ? h.closest(itemSel) : null;
      }
      return t.closest(itemSel);
    }

    // 座標が乗っている要素と、その前半分（before）か後半分（after）かを返す。
    // horizontal のときは左右（clientX）、それ以外は上下（clientY）で判定する。
    function dropTarget(clientX, clientY) {
      var list = items();
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (horizontal) {
          if (clientX >= r.left && clientX <= r.right) {
            return { node: list[i], before: (clientX - r.left) < r.width / 2 };
          }
        } else if (clientY >= r.top && clientY <= r.bottom) {
          return { node: list[i], before: (clientY - r.top) < r.height / 2 };
        }
      }
      return null;
    }
    function clearIndicators() {
      items().forEach(function (n) { n.classList.remove("drag-over-before", "drag-over-after"); });
    }
    function updateIndicator(clientX, clientY) {
      clearIndicators();
      var t = dropTarget(clientX, clientY);
      if (t) t.node.classList.add(t.before ? "drag-over-before" : "drag-over-after");
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

    // ドラッグ直後に発火するクリックを無視する（タブのように要素自体がクリック可能な
    // 場合に、並べ替えただけでタブが切り替わってしまうのを防ぐ）。並べ替えが起きなかった
    // ドラッグ（同じ位置に戻した場合など）でも同様に抑止したいので、確定処理ではなく
    // ドラッグ終了そのもの（dragend / タッチドラッグ終了）で時刻を記録する。
    var lastDragEnd = 0;
    container.addEventListener("click", function (e) {
      if (Date.now() - lastDragEnd < 350) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    // PC: ネイティブ Drag and Drop API
    var dragId = null;
    var dragStarted = false;   // drop で dragId を消すため、ドラッグ有無は別途持つ
    container.addEventListener("dragstart", function (e) {
      var item = itemFromEvent(e);
      if (!item) { e.preventDefault(); return; }
      dragId = idOf(item);
      dragStarted = true;
      item.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", dragId); } catch (err) {}
      e.dataTransfer.effectAllowed = "move";
    });
    container.addEventListener("dragend", function () {
      items().forEach(function (n) { n.classList.remove("dragging"); });
      clearIndicators();
      if (dragStarted) lastDragEnd = Date.now();
      dragStarted = false;
      dragId = null;
    });
    container.addEventListener("dragover", function (e) {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      updateIndicator(e.clientX, e.clientY);
    });
    container.addEventListener("drop", function (e) {
      if (!dragId) return;
      e.preventDefault();
      var target = dropTarget(e.clientX, e.clientY);
      var id = dragId;
      items().forEach(function (n) { n.classList.remove("dragging"); });
      dragId = null;
      dragStarted = false;
      // ここで記録しておく必要がある。commit → onReorder で呼び出し側が要素を作り直すと
      // ドラッグ元の要素がDOMから外れ、直後の dragend が container まで伝播しなくなるため。
      lastDragEnd = Date.now();
      commit(id, target);
    });

    // スマホ: タップ長押しでドラッグ開始（長押し判定中に指が動いたらスクロールとみなし中止）。
    // タブバーのように横スクロールする要素でも、指を止めたまま450ms待った時だけドラッグに
    // 移行するため、通常のスワイプによるスクロールは今までどおり行える。
    var touch = null;
    container.addEventListener("touchstart", function (e) {
      var item = itemFromEvent(e);
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
      // ドラッグ確定後はスクロールへ奪われないよう既定動作を止める
      e.preventDefault();
      moveGhost(t.clientX, t.clientY);
      updateIndicator(t.clientX, t.clientY);
    }, { passive: false });
    container.addEventListener("touchend", function (e) {
      if (!touch) return;
      clearTimeout(touch.timer);
      if (touch.dragging) {
        e.preventDefault();
        var t = (e.changedTouches && e.changedTouches[0]) || touch;
        var target = dropTarget(t.clientX, t.clientY);
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
      var ghost = create("div", { id: "sortlist-drag-ghost", class: "sortlist-drag-ghost" }, ghostHtml(touch.item));
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
      lastDragEnd = Date.now();
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
