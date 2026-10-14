/* Optional paginated output for physical booklet parity and cover-excluded folios.
   Paged.js is loaded locally inside an isolated frame only when either option is on. */
(function () {
  "use strict";
  var activeFrame;
  async function prepare(area, opts) {
    if (activeFrame) activeFrame.remove();
    var frame = document.createElement("iframe");
    frame.title = "冊子印刷用ドキュメント";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
    document.body.appendChild(frame);
    activeFrame = frame;
    try {
      var doc = frame.contentDocument;
      doc.open(); doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="booklet-pages"></div></body></html>'); doc.close();
      var base = doc.createElement("base"); base.href = document.baseURI; doc.head.appendChild(base);
      var styles = await Promise.all(Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(async function (link) {
        var url = new URL(link.href);
        if (url.origin !== location.origin) {
          return new Promise(function (resolve) {
            var fontLink = link.cloneNode(true);
            fontLink.onload = fontLink.onerror = function () { resolve(""); };
            doc.head.appendChild(fontLink);
          });
        }
        var response = await fetch(url.href);
        if (!response.ok) throw new Error("印刷用スタイルを読み込めませんでした");
        // Resolve relative font/image URLs against each stylesheet, not the frame.
        return (await response.text()).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, function (_, quote, value) {
          return 'url("' + new URL(value, url.href).href + '")';
        });
      }));
      var css = styles.join("\n")
        .replace(/@media\s+print\b/g, "@media all")
        .replace(/body\s*>\s*\*:not\(#print-area\)\s*\{[^}]*\}/g, "")
        .replace(/#print-area\s*\{\s*display:\s*none;?\s*\}/g, "")
        .replace(/#print-area/g, ".booklet-source");
      // Paged.js needs print rules at the top level to discover forced breaks.
      var sheet = new frame.contentWindow.CSSStyleSheet();
      sheet.replaceSync(css);
      function flatten(rules) {
        return Array.from(rules).map(function (rule) {
          if (rule.type === 4) return frame.contentWindow.matchMedia(rule.conditionText).matches ? flatten(rule.cssRules) : "";
          return rule.cssText;
        }).join("\n");
      }
      css = flatten(sheet.cssRules);
      css += "\n@page{size:A4;margin:15mm 0;} .booklet-source.print-out{page:auto;}\nhtml,body{margin:0;padding:0;min-height:0;background:white;}" +
        ".booklet-source.print-out .print-cover{height:267mm;box-sizing:border-box;}";
      await new Promise(function (resolve, reject) {
        var script = doc.createElement("script");
        script.src = new URL("assets/vendor/pagedjs/paged.min.js", document.baseURI).href;
        script.onload = resolve; script.onerror = function () { reject(new Error("冊子のページ割り処理を読み込めませんでした")); };
        doc.head.appendChild(script);
      });
      var source = area.cloneNode(true);
      source.removeAttribute("id");
      source.classList.remove("print-page-numbers");
      source.classList.add("booklet-source");
      var sourceStyle = doc.createElement("style"); sourceStyle.textContent = css; doc.head.appendChild(sourceStyle);
      doc.body.appendChild(source);
      await doc.fonts.ready;
      await Promise.all(Array.from(source.querySelectorAll("img")).map(function (img) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }));
      // Paged.js 0.4 marks any inline-styled node without explicit display as hidden.
      [source].concat(Array.from(source.querySelectorAll("[style]"))).forEach(function (node) {
        if (!node.style.display) node.style.display = frame.contentWindow.getComputedStyle(node).display;
      });
      source.remove(); sourceStyle.remove();
      var answerStart = source.querySelector(".print-exam-a, .print-part-a");
      if (answerStart) answerStart.setAttribute("data-booklet-answer-start", "true");
      var previewer = new frame.contentWindow.PagedModule.Previewer();
      await previewer.preview(source.outerHTML, [{"booklet.css": css}], doc.getElementById("booklet-pages"));
      await doc.fonts.ready;
      var pages = Array.from(doc.querySelectorAll(".pagedjs_page"));
      // A forced left break at the very start is ignored by pagination engines.
      var answerIndex = pages.findIndex(function (page) { return !!page.querySelector("[data-booklet-answer-start]"); });
      if (opts.answerLeft && answerIndex >= 0 && answerIndex % 2 === 0) {
        var blank = pages[answerIndex].cloneNode(true);
        blank.removeAttribute("id");
        blank.classList.add("pagedjs_blank_page");
        Array.from(blank.querySelectorAll(".pagedjs_page_content, .pagedjs_margin-content, .pagedjs_footnote_inner_content")).forEach(function (node) { node.innerHTML = ""; });
        pages[answerIndex].before(blank);
        pages = Array.from(doc.querySelectorAll(".pagedjs_page"));
      }
      var hasCover = !!source.querySelector(".print-cover");
      pages.forEach(function (page, index) {
        if (!opts.pageNumbers || (hasCover && index === 0) || page.classList.contains("pagedjs_blank_page")) return;
        var folio = doc.createElement("div");
        folio.className = "booklet-folio";
        folio.textContent = String(index + 1 - (hasCover ? 1 : 0));
        page.appendChild(folio);
      });
      var outputStyle = doc.createElement("style");
      outputStyle.textContent = "@page{size:A4;margin:0;}html,body{margin:0;padding:0;}" +
        ".pagedjs_page{margin:0!important;box-shadow:none!important;position:relative;break-after:page;}" +
        ".pagedjs_page:last-child{break-after:auto;}" +
        ".booklet-folio{position:absolute;bottom:6mm;left:0;right:0;text-align:center;font:10pt Arial,sans-serif;color:#000;}";
      doc.head.appendChild(outputStyle);
      return frame;
    } catch (error) { frame.remove(); throw error; }
  }
  window.PrintBooklet = {prepare: prepare};
})();
