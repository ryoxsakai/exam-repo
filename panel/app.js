import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import '../assets/js/markup.js';

const app = new App({ name: 'Exam 問題ブラウザー', version: '1.0.0' }, { availableDisplayModes:['fullscreen'] });
const extensions = new OpenAIExtensions(app);
const $ = id => document.getElementById(id);
let current = null, field = 'problem_text', selected = '', requestId = 0, attached = false;
let canShare = false, imageOrigin = '';
const fieldLabels = { problem_text: '問題', answer_text: '解答', translation_text: '全訳', commentary_text: '解説' };
const markup = window.Markup;
function status(text) { $('status').textContent = text; }
function title(q) { return `${q.university_name} ${q.year}年 ${q.schedule || ''} 大問${q.question_number}`.replace(/\s+/g, ' ').trim(); }
function data(result) {
  if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text || '取得できませんでした。');
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find(c => c.type === 'text')?.text;
  if (!text) throw new Error('Examからデータが返りませんでした。');
  return JSON.parse(text);
}
async function call(name, args) { return data(await app.callServerTool({ name, arguments: args })); }
function resetSelection() {
  selected = ''; $('share').disabled = true;
  $('selection-preview').textContent = canShare ? '共有する文章を選択してください。' : 'この画面では共有機能を利用できません。';
}
function renderResults(rows) {
  $('results').replaceChildren();
  $('result-count').textContent = rows.length ? `${rows.length}件（最大100件）。条件を絞って検索できます。` : '一致する問題がありません。条件を変更してください。';
  for (const row of rows) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'result';
    const name = document.createElement('strong'); name.textContent = title(row);
    const label = document.createElement('span'); label.textContent = [row.category, row.label].filter(Boolean).join(' · ');
    button.append(name, label); button.addEventListener('click', () => openQuestion(row)); $('results').append(button);
  }
}
function renderField(next) {
  field = next; resetSelection();
  const doc = $('document'); doc.replaceChildren();
  for (const tab of $('tabs').children) { const active = tab.dataset.field === next; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  const activeTab = [...$('tabs').children].find(t => t.dataset.field === next); doc.setAttribute('aria-labelledby', activeTab.id);
  let sections = markup.parseSections(current[field] || '');
  if (field === 'problem_text') sections = sections.filter(s => !['解答', '全訳', '解説'].includes(s.type));
  sections = markup.mergeLeadSections(sections);
  if (!sections.some(s => s.text.trim())) { doc.textContent = 'この内容はまだ登録されていません。'; return; }
  for (const s of sections) {
    const block = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = s.type === '問題' ? fieldLabels[field] : s.type;
    const content = document.createElement('div');
    if (!['本文','和訳','全訳'].includes(s.type) && field !== 'translation_text') content.className = 'no-indent exam-doc';
    const rendered = markup.render(s.text, { paraNum: ['本文', '和訳'].includes(s.type), zenyaku: field === 'translation_text' || s.type === '全訳' });
    content.innerHTML = rendered.html;
    // Registered text is rendered with the site's escaping parser. Keep image
    // requests on the permitted Exam origin (no arbitrary external requests).
    for (const img of content.querySelectorAll('img')) {
      try { const url = new URL(img.getAttribute('src')); if (url.origin !== imageOrigin || !url.pathname.startsWith('/api/image/')) img.replaceWith(document.createTextNode(`[画像：${img.alt || '図'}]`)); }
      catch { img.replaceWith(document.createTextNode(`[画像：${img.alt || '図'}]`)); }
    }
    block.append(heading, content);
    doc.append(block);
  }
}
function renderQuestion(q, examId) {
  current = { ...q, exam_id: examId }; $('question-title').textContent = title(current);
  $('tabs').replaceChildren();
  for (const [key, label] of Object.entries(fieldLabels)) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = label; tab.id = `tab-${key}`;
    tab.dataset.field = key; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'document');
    tab.addEventListener('click', () => renderField(key));
    tab.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const tabs = [...$('tabs').children]; const index = tabs.indexOf(tab); const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[target].click(); tabs[target].focus(); });
    $('tabs').append(tab);
  }
  $('results-area').hidden = true; $('detail').hidden = false; $('share-bar').hidden = false;
  renderField('problem_text');
}
async function openQuestion(row) {
  const id = ++requestId; status('大問を読み込んでいます…');
  try { const result = await call('get_question', { exam_id: row.exam_id, question_number: row.question_number }); if (id !== requestId) return; renderQuestion(result.question, row.exam_id); status('本文・設問の文章を選択して共有できます。'); $('question-title').scrollIntoView({ block:'start' }); }
  catch (error) { if (id === requestId) status(`大問の取得に失敗しました：${error.message}`); }
}
async function search(event) {
  event.preventDefault(); const id = ++requestId; const args = { limit:100 };
  for (const [key, value] of new FormData($('search-form'))) { const trimmed = String(value).trim(); if (trimmed) args[key] = key === 'year' ? Number(trimmed) : trimmed; }
  $('search').disabled = true; status('検索しています…');
  try { const result = await call('search_questions', args); if (id !== requestId) return; renderResults(result.results || []); showResults(); status('検索結果から大問を選んでください。'); }
  catch (error) { if (id === requestId) status(`検索に失敗しました：${error.message}`); }
  finally { $('search').disabled = false; }
}
function showResults() { $('results-area').hidden = false; $('detail').hidden = true; $('share-bar').hidden = true; current = null; resetSelection(); }
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const doc = $('document');
  if (!doc.contains(selection.anchorNode) || !doc.contains(selection.focusNode)) return;
  selected = selection.toString().trim(); $('share').disabled = !selected || !canShare;
  $('selection-preview').textContent = selected.length > 240 ? `${selected.slice(0,240)}…（${selected.length}文字）` : selected;
});
$('share').addEventListener('click', async () => {
  if (!current || !selected || !canShare) return;
  if (selected.length > 20000) { status('共有する文章を20,000文字以内に絞ってください。'); return; }
  const snapshot = { exam_id:current.exam_id, question_number:current.question_number, university_name:current.university_name, year:current.year, schedule:current.schedule, field, selected_text:selected };
  const heading = `${title(current)} · ${fieldLabels[field]}`;
  $('share').disabled = true;
  try {
    await app.updateModelContext({ content:[{ type:'text', text:`${heading}\n\n${snapshot.selected_text}`, _meta:{ 'openai/title':heading } }], structuredContent:{ exam_selection:snapshot } });
    attached = true; $('clear-share').hidden = false; status('選択箇所をチャットに添付しました。質問を入力してください。');
  } catch (error) { status(`共有できませんでした：${error.message}`); }
  finally { $('share').disabled = !selected || !canShare; }
});
$('clear-share').addEventListener('click', async () => {
  try { await app.updateModelContext({ content:[], structuredContent:{} }); attached = false; $('clear-share').hidden = true; status('添付を解除しました。'); }
  catch (error) { status(`添付を解除できませんでした：${error.message}`); }
});
$('search-form').addEventListener('submit', search);
$('back').addEventListener('click', () => { ++requestId; showResults(); });
function theme(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  const ctx = extensions.modelContext?.getCurrent();
  if (ctx !== undefined && attached && (!ctx || !ctx.structuredContent?.exam_selection)) { attached = false; $('clear-share').hidden = true; }
}
app.onhostcontextchanged = theme;
app.ontoolresult = result => {
  try { const initial = data(result); imageOrigin = new URL(initial.image_base).origin; markup.setImageBase(imageOrigin); renderResults(initial.results || []); if (initial.question) renderQuestion(initial.question, initial.exam_id); status('検索結果から大問を選ぶか、条件を入力してください。'); }
  catch (error) { status(error.message); }
};
try {
  await app.connect(); theme(app.getHostContext());
  canShare = Boolean(app.getHostCapabilities()?.updateModelContext);
  $('search').disabled = false; resetSelection();
  const host = app.getHostContext();
  if (host?.displayMode === 'inline' && host.availableDisplayModes?.includes('fullscreen')) await app.requestDisplayMode({ mode:'fullscreen' });
} catch (error) { status(`Examに接続できませんでした。プラグインを再接続して開き直してください。${error.message}`); }
