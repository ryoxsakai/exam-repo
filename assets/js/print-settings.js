/* Shared allowlist for saved print layouts; never includes connection, auth or master durations. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PrintSettings = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var checks = "cover duration name-field page-numbers answer-left hide-labels qbreak-q qbreak-a sbreak-q sbreak-a hide-head-q hide-head-a qsubtitle renumber linenum line-refs optimize-choices optimize-answers optimize-footnotes compact-commentary writing-space grayscale question-exam-break answer-exam-break".split(" ");
  var values = {fontsize:["xs","sm","md","lg","xl"],lineheight:["1","2","3","4","5"],"page-number-style":["plain","hyphen","wide-hyphen","total"],"writing-lines":["5","10","15","20","25"]};
  function valid(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 1 || Object.keys(data).some(function(k){return ["version","controls","sections"].indexOf(k)<0;})) return false;
    if (!data.controls || typeof data.controls !== "object" || Array.isArray(data.controls)) return false;
    if (!Object.keys(data.controls).every(function(k){return checks.indexOf(k)>=0 ? typeof data.controls[k]==="boolean" : Object.prototype.hasOwnProperty.call(values,k) && values[k].indexOf(data.controls[k])>=0;})) return false;
    return data.sections && typeof data.sections === "object" && !Array.isArray(data.sections) && Object.keys(data.sections).length<=100 && Object.keys(data.sections).every(function(k){return k.length>0 && k.length<=120 && typeof data.sections[k]==="boolean" && ["__proto__","constructor","prototype"].indexOf(k)<0;});
  }
  function capture(doc, store) {
    var controls = {}, sections = {};
    checks.forEach(function(k){var n=doc.getElementById("pr-"+k);if(n)controls[k]=n.checked;});
    Object.keys(values).forEach(function(k){var n=doc.getElementById("pr-"+k);if(n)controls[k]=n.value;});
    doc.querySelectorAll("[data-prsec]").forEach(function(n){var k=n.getAttribute("data-prsec");sections[k]=store.isPrintSection(k);});
    return {version:1,controls:controls,sections:sections};
  }
  function apply(data, doc, store) {
    if (!valid(data)) return false;
    Object.keys(data.controls).forEach(function(k){
      var n=doc.getElementById("pr-"+k);if(!n)return;
      if(checks.indexOf(k)>=0)n.checked=data.controls[k];else n.value=data.controls[k];
      n.dispatchEvent(new Event("change",{bubbles:true}));
    });
    Object.keys(data.sections).forEach(function(k){store.setPrintSection(k,data.sections[k]);});
    return true;
  }
  return {valid:valid,capture:capture,apply:apply};
});
