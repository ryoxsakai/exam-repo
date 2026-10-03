const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const nodes = {};
function element() {
  const classes = new Set();
  return {value: '', disabled: false, hidden: false, options: [], textContent: '', classList: {contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c)},
    set innerHTML(v) { this.options = v.includes('option') ? [{value: '', textContent: '最上位'}] : []; this.value = ''; },
    appendChild(o) { this.options.push(o); }, focus() {}};
}
for (const id of ['favorite-folder-modal', 'favorite-folder-modal-title', 'favorite-folder-modal-icon', 'fav-folder-name-label', 'fav-folder-name', 'fav-folder-parent-field', 'fav-folder-parent-status', 'fav-folder-parent', 'fav-folder-save']) nodes[id] = element();
const calls = [], messages = [];
let folders = [{id: 1, name: '医療', parent_id: null}, {id: 2, name: '演習', parent_id: 1}, {id: 3, name: '英語', parent_id: null}, {id: 4, name: '演習', parent_id: 3}, {id: 5, name: '演習', parent_id: 3}, {id: 6, name: '<b>&</b>', parent_id: 2}, {id: 7, name: '__proto__', parent_id: null}];
let user = {}, resolveSave, rejectSave, getFavorites;
const ctx = {console, setTimeout: f => f(), document: {createElement: element},
  UI: {el: id => nodes[id], toast: (...args) => messages.push(args), openModal: n => n.classList.add('open'), closeModal: n => n.classList.remove('open')},
  Store: {getFavCollapsed: () => ({}), pruneCachedExams() {}, pruneFavCollapsed() {}, setFavCollapsed() {}},
  Auth: {getCurrentUser: () => user},
  Api: {getFavorites: () => getFavorites(), createFavoriteFolder: (...args) => {calls.push(args); return new Promise((r, j) => {resolveSave = r; rejectSave = j;});}, renameFavoriteFolder: (...args) => {calls.push(['rename', ...args]); return Promise.resolve();}}};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "assets/js/difficulty.js"), "utf8"), ctx);
const script = fs.readFileSync(path.join(root, 'assets/js/viewer.js'), 'utf8');
vm.runInContext(script.replace('document.addEventListener("DOMContentLoaded", init);', 'window.test = {state, openFavoriteFolderModal, saveFavoriteFolderModal, favoriteFolderParentTargets};'), ctx);
const {state, openFavoriteFolderModal: open, saveFavoriteFolderModal: save} = ctx.test;
const modal = nodes['favorite-folder-modal'], select = nodes['fav-folder-parent'], name = nodes['fav-folder-name'], button = nodes['fav-folder-save'];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const newFolder = () => open({mode: 'create', kind: 'folder', parentId: null});
const normalFetch = () => Promise.resolve({folders, favorites: [], sections: [{id: 90, name: 'section', parent_id: null}]});
const equal = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
(async () => {
  getFavorites = normalFetch;
  newFolder(); assert.equal(button.disabled, true); await flush();
  equal(select.options.map(o => o.textContent), ['最上位', '医療', '医療 / 演習', '医療 / 演習 / <b>&</b>', '英語', '英語 / 演習（ID: 4）', '英語 / 演習（ID: 5）', '__proto__']);
  assert.equal(button.disabled, false);
  save(); assert.equal(calls.length, 0);
  name.value = ' 子 '; select.value = '2'; state.favCollapsed = {1: true, 2: true};
  save(); save(); equal(calls, [['子', 2, 'folder']]); assert.equal(button.disabled, true);
  resolveSave(); await flush(); assert.equal(modal.classList.contains('open'), false); equal(state.favCollapsed, {1: false, 2: false});
  newFolder(); await flush(); assert.equal(select.value, '');
  name.value = 'キャンセル'; ctx.UI.closeModal(modal); save(); assert.equal(calls.length, 1);
  newFolder(); await flush(); name.value = 'root'; save(); equal(calls[1], ['root', null, 'folder']);
  ctx.UI.closeModal(modal); newFolder(); await flush(); name.value = 'new dialog'; resolveSave(); await flush(); assert.equal(modal.classList.contains('open'), true); assert.equal(name.value, 'new dialog');
  select.value = '4'; save(); rejectSave(new Error('missing parent')); await flush(); assert.equal(button.disabled, false); assert.equal(modal.classList.contains('open'), true); assert.equal(select.value, '4'); save(); equal(calls[3], ['new dialog', 4, 'folder']); resolveSave(); await flush();
  newFolder(); await flush(); name.value = 'invalid'; select.value = '90'; save(); assert.equal(calls.length, 4);
  select.value = '5'; state.favFolders = folders.filter(f => f.id !== 5); save(); assert.equal(calls.length, 4);
  open({mode: 'rename', kind: 'folder', id: 2, name: '演習'}); assert.equal(nodes['fav-folder-parent-field'].hidden, true); name.value = 'renamed'; save(); await flush(); equal(calls[4], ['rename', 2, 'renamed']);
  open({mode: 'create', kind: 'section', parentId: null}); assert.equal(nodes['fav-folder-parent-field'].hidden, true); name.value = 'section'; save(); equal(calls[5], ['section', null, 'section']); resolveSave(); await flush();
  // A failed initial/refresh load blocks save and is retryable by reopening.
  getFavorites = () => Promise.reject(new Error('offline')); newFolder(); await flush(); assert.equal(button.disabled, true); name.value = 'no'; save(); assert.equal(calls.length, 6); assert.equal(state.favSet, null);
  getFavorites = normalFetch; newFolder(); await flush(); assert.equal(button.disabled, false);
  // Closing during load must not open again. Older loads cannot alter a newer dialog.
  let resolveLoad; getFavorites = () => new Promise(r => {resolveLoad = r;}); newFolder(); ctx.UI.closeModal(modal); resolveLoad({folders, favorites: []}); await flush(); assert.equal(modal.classList.contains('open'), false);
  newFolder(); open({mode: 'rename', kind: 'folder', id: 1, name: 'keep'}); resolveLoad({folders, favorites: []}); await flush(); assert.equal(name.value, 'keep'); assert.equal(nodes['fav-folder-parent-field'].hidden, true);
  folders = []; getFavorites = normalFetch; newFolder(); await flush(); equal(select.options.map(o => o.textContent), ['最上位']);
  ctx.UI.closeModal(modal); user = null; newFolder(); assert.equal(modal.classList.contains('open'), false);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<div id="fav-folder-parent-field" hidden><label class="field">/);
  console.log('PASS: folder parent hierarchy/IDs/escaping, root and nested create, empty names, repeat saves, cancel/reopen, retry, invalid parents, rename/section, loading failure/retry/interruption, empty account, logged out');
})().catch(e => {console.error(e); process.exitCode = 1;});
