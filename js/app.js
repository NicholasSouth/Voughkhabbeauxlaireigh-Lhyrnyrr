'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- storage (browser localStorage) ---------- */
const KEY = 'vocabdesk.v1', PKEY = 'vocabdesk.prefs';
let db = (() => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.lessons)) return { lessons: d.lessons, groups: d.groups || [], scores: d.scores || {} }; } catch (e) {} return { lessons: [], groups: [], scores: {} }; })();
const PDEF = { count: 12, mode: 'flip', side: 'w', vol: 0.6, shuffleTracks: false, loop: 'all', track: '', trackId: '', folded: false, muted: false, theme: 'blue', tone: 'light', font: 'times' };
let prefs = (() => { try { return Object.assign({}, PDEF, JSON.parse(localStorage.getItem(PKEY)) || {}); } catch (e) { return { ...PDEF }; } })();
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Could not save to browser storage (is it full or blocked?)'); } }
function savePrefs() { try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch (e) {} }

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3800); }

function ask({ title, message = '', input = null, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = $('#dlg'), inp = $('#dlgInput'), okb = $('#dlgOk');
    $('#dlgTitle').textContent = title; $('#dlgMsg').textContent = message; $('#dlgMsg').hidden = !message;
    inp.hidden = input === null; inp.value = input ?? '';
    okb.textContent = ok; okb.className = danger ? 'danger' : 'primary';
    let done = false;
    const finish = (v) => { if (done) return; done = true; $('#dlgForm').onsubmit = null; $('#dlgCancel').onclick = null; d.onclose = null; d.close(); resolve(v); };
    $('#dlgForm').onsubmit = (e) => { e.preventDefault(); finish(input === null ? true : (inp.value.trim() || null)); };
    $('#dlgCancel').onclick = () => finish(null);
    d.onclose = () => finish(null);
    d.showModal(); if (input !== null) { inp.focus(); inp.select(); }
  });
}

/* ---------- parsing sheets into lessons ---------- */
const clean = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const HEAD = { w: /^(word|t\u1EEB|tu|term|vocab)$/i, f: /^(form|lo\u1EA1i|loai|type|pos)$/i, d: /^(definition|ngh\u0129a|nghia|meaning|def)$/i };
const SECTION_RE = /^(trang|page|pages|p\.|lesson|unit|b\u00E0i|bai|section|part|chapter)\b/i;
const nice = (t) => (t === t.toUpperCase() && /[A-Za-z\u00C0-\u1EF9]/.test(t)) ? t.charAt(0) + t.slice(1).toLowerCase() : t;

/* Rows that are merged across columns (or a lone cell starting with "Trang", "Page", "Unit"...) start a new lesson. */
function extractSections(sheet) {
  const { rows, merges } = sheet;
  const cols = { w: 0, f: 1, d: 2 };
  const out = []; let cur = { title: '', cards: [] }; out.push(cur); let skipped = 0;
  for (let r = 0; r < rows.length; r++) {
    const raw = rows[r]; if (!raw) continue;
    const cells = []; for (let i = 0; i < Math.max(3, raw.length); i++) cells.push(clean(raw[i]));
    if (!cells.some(Boolean)) continue;
    const merged = merges.some((m) => m.r1 <= r && r <= m.r2 && m.c2 > m.c1 && m.c1 === 0);
    if (!merged && HEAD.w.test(cells[0]) && (HEAD.f.test(cells[1]) || HEAD.d.test(cells[1]) || HEAD.d.test(cells[2]))) {
      cols.f = -1; cols.d = -1;
      cells.forEach((v, i) => { if (HEAD.w.test(v)) cols.w = i; else if (HEAD.f.test(v)) cols.f = i; else if (HEAD.d.test(v)) cols.d = i; });
      continue;
    }
    const w = cells[cols.w] || '', f = cols.f >= 0 ? cells[cols.f] : '', d = cols.d >= 0 ? cells[cols.d] : '';
    const lone = cells.filter(Boolean).length === 1 && cells[0];
    if (merged || (lone && SECTION_RE.test(cells[0]))) {
      const title = nice(cells.filter(Boolean).join(' '));
      cur = { title, cards: [] }; out.push(cur); continue;
    }
    if (w && d) cur.cards.push({ w, f, d }); else skipped++;
  }
  return { sections: out.filter((s) => s.cards.length), skipped };
}

async function importFiles(fileList) {
  const autoGroup = $('#autoGroup') ? $('#autoGroup').checked : true;
  const lines = [];
  for (const file of fileList) {
    try {
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
      let sheets;
      if (/\.(xlsx|xlsm)$/i.test(file.name)) sheets = await Reader.readXlsx(await file.arrayBuffer());
      else if (/\.(csv|tsv|txt)$/i.test(file.name)) sheets = Reader.parseCsv(await file.text());
      else throw new Error('use .xlsx or .csv');
      let sections = [], skipped = 0;
      sheets.forEach((sh) => {
        const res = extractSections(sh); skipped += res.skipped;
        res.sections.forEach((s) => { if (!s.title && sheets.length > 1) s.title = sh.name; sections.push(s); });
      });
      if (!sections.length) throw new Error('no rows with a word and a definition were found');
      const made = [];
      sections.forEach((s) => {
        const name = s.title ? `${base} \u00B7 ${s.title}` : base;
        let l = db.lessons.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (l) { l.cards = s.cards; l.file = base; } else { l = { id: uid(), name, file: base, cards: s.cards }; db.lessons.push(l); }
        made.push(l);
      });
      if (autoGroup && made.length > 1) {
        let g = db.groups.find((x) => x.name.toLowerCase() === base.toLowerCase());
        if (!g) { g = { id: uid(), name: base, lessonIds: [] }; db.groups.push(g); }
        made.forEach((l) => { if (!g.lessonIds.includes(l.id)) g.lessonIds.push(l.id); });
      }
      const total = made.reduce((n, l) => n + l.cards.length, 0);
      lines.push(`${file.name}: ${plural(made.length, 'lesson')}, ${plural(total, 'word')}${skipped ? ` (${skipped} incomplete row${skipped > 1 ? 's' : ''} skipped)` : ''}`);
    } catch (err) { lines.push(`${file.name}: could not import \u2013 ${err.message}`); }
  }
  save(); render();
  toast(lines.join('\n'));
}

/* ---------- state / routing ---------- */
let view = 'library', session = null; const selected = new Set();
const lessonById = (id) => db.lessons.find((l) => l.id === id);
const cardsOf = (ids) => ids.flatMap((id) => (lessonById(id)?.cards || []).map((c) => ({ ...c, l: id })));

/* ---------- best scores (saved per lesson / per group of lessons, in the browser) ---------- */
const sessionKey = (ids) => ids.slice().sort().join('+');
const pct = (r) => Math.round(r * 100);
const scoreBucket = () => (db.scores[session.key] = db.scores[session.key] || {});
function pruneScores(ids) { const set = new Set(ids); Object.keys(db.scores).forEach((k) => { if (k.split('+').some((id) => set.has(id))) delete db.scores[k]; }); }
const matchBest = (mode, pairs) => db.scores[session.key]?.match?.[`${mode}:${pairs}`] || null;
const fmtBest = (b) => b ? `${pct(b.acc)}% &#183; ${fmtTime(b.ms)}` : '&#8212;';
/* small tags for the library: best flashcard accuracy + best Match (largest board per mode) */
function scoreTags(key) {
  const s = db.scores[key]; if (!s) return '';
  const out = [];
  if (s.flash) out.push(`<span class="tag" title="Best flashcard accuracy">Cards ${pct(s.flash.acc)}%</span>`);
  [['flip', 'flip'], ['faceup', 'face-up']].forEach(([m, label]) => {
    const e = Object.entries(s.match || {}).filter(([k]) => k.startsWith(m + ':')).sort((a, b) => +b[0].split(':')[1] - +a[0].split(':')[1])[0];
    if (e) out.push(`<span class="tag" title="Best Match score: ${label}, ${e[0].split(':')[1]} pairs (accuracy &#183; time)">Match ${label} ${e[0].split(':')[1]}p ${fmtBest(e[1])}</span>`);
  });
  return out.join('');
}

function startSession(title, ids, mode) {
  const cards = cardsOf(ids);
  if (!cards.length) return toast('Nothing to study there yet.');
  session = { title, ids, cards, key: sessionKey(ids) }; go(mode);
}
function go(v) { stopGame(); view = v; render(); window.scrollTo(0, 0); }
function render() {
  document.body.dataset.view = view;
  $$('#nav button').forEach((b) => { b.classList.toggle('on', b.dataset.go === view); if (b.dataset.go !== 'library') b.disabled = !session; });
  const tag = $('#sessionTag'); tag.hidden = !session || !['flash', 'match'].includes(view);
  if (session) tag.textContent = `${session.title} \u00B7 ${plural(session.cards.length, 'word')}`;
  ({ library: renderLibrary, flash: renderFlash, match: renderMatch, edit: renderEdit })[view]();
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; if (view === 'edit') { leaveEdit(); return; } go(b.dataset.go); });

/* ---------- library ---------- */
function renderLibrary() {
  const main = $('#main');
  const groupsHtml = db.groups.map((g) => {
    const ls = g.lessonIds.map(lessonById).filter(Boolean);
    const words = ls.reduce((n, l) => n + l.cards.length, 0);
    return `<article class="card group" data-g="${g.id}">
      <div><h3>${esc(g.name)}</h3><div class="muted" style="font-size:.88rem">${plural(ls.length, 'lesson')} &#183; ${plural(words, 'word')}</div>${scoreTags(sessionKey(ls.map((l) => l.id))) ? `<div class="row" style="margin-top:.3rem">${scoreTags(sessionKey(ls.map((l) => l.id)))}</div>` : ''}</div>
      <div class="chips">${ls.map((l) => `<span class="chip">${esc(l.name.replace(g.name + ' \u00B7 ', ''))}<button data-act="ungroup" data-l="${l.id}" title="Remove from group" aria-label="Remove ${esc(l.name)} from group">\u00D7</button></span>`).join('') || '<span class="muted" style="font-size:.88rem">Empty \u2013 select lessons below and add them here.</span>'}</div>
      <div class="row"><button class="primary sm" data-act="studyGroup" data-m="flash" ${ls.length ? '' : 'disabled'}>Flashcards</button><button class="accent sm" data-act="studyGroup" data-m="match" ${ls.length ? '' : 'disabled'}>Match</button>
      <span style="flex:1"></span><button class="ghost sm" data-act="renameGroup">Rename</button><button class="ghost sm danger" data-act="deleteGroup">Delete group</button></div></article>`;
  }).join('');

  const lessonsHtml = db.lessons.map((l) => {
    const gs = db.groups.filter((g) => g.lessonIds.includes(l.id));
    return `<div class="card lesson ${selected.has(l.id) ? 'sel' : ''}" data-l="${l.id}">
      <input type="checkbox" data-act="select" ${selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.name)}">
      <div><div class="name">${esc(l.name)}</div><div class="meta"><span>${plural(l.cards.length, 'word')}</span>${gs.map((g) => `<span class="tag">${esc(g.name)}</span>`).join('')}${scoreTags(l.id)}</div></div>
      <div class="row"><button class="primary sm" data-act="studyLesson" data-m="flash">Flashcards</button><button class="accent sm" data-act="studyLesson" data-m="match">Match</button><button class="sm" data-act="editLesson" title="Rename the lesson or edit its words">Edit</button><button class="ghost sm danger" data-act="removeLesson" title="Remove this lesson from the browser">Remove</button></div></div>`;
  }).join('');

  const n = selected.size;
  main.innerHTML = `
    <section class="card drop" id="drop">
      <div class="txt"><h1>Import your vocabulary</h1>
      <p class="hint">Excel (<code>.xlsx</code>) or <code>.csv</code> with three columns: <code>word</code> &#183; <code>form</code> &#183; <code>definition</code>.
      Merged rows (or a row like <code>Trang 18</code>) start a new lesson automatically.</p>
      <label class="chk"><input type="checkbox" id="autoGroup" checked> Put lessons from the same file into one group</label></div>
      <div class="row"><button class="primary" data-act="browse">Choose files&#8230;</button><span class="muted">or drop them here</span></div>
      <input type="file" id="fileIn" accept=".xlsx,.xlsm,.csv,.tsv,.txt" multiple hidden>
    </section>

    <div class="sec-head"><h2>Groups</h2><span class="muted">${db.groups.length ? plural(db.groups.length, 'group') : ''}</span><span class="sp"></span><button class="sm" data-act="newGroup">&#65291; New group</button></div>
    ${db.groups.length ? `<div class="groups">${groupsHtml}</div>` : '<div class="card empty">No groups yet. Select a few lessons below and add them to a group to study them together.</div>'}

    <div class="sec-head"><h2>Lessons</h2><span class="muted">${db.lessons.length ? `${plural(db.lessons.length, 'lesson')} &#183; ${plural(db.lessons.reduce((a, l) => a + l.cards.length, 0), 'word')} saved in this browser` : ''}</span></div>
    ${db.lessons.length ? `
    <div class="card toolbar">
      <label class="row"><input type="checkbox" data-act="selectAll" ${n === db.lessons.length ? 'checked' : ''}> <span>${n ? `${n} selected` : 'Select all'}</span></label>
      <select data-act="addToGroup" ${n ? '' : 'disabled'} aria-label="Add selected lessons to a group"><option value="">Add to group&#8230;</option>${db.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}<option value="__new">&#65291; New group&#8230;</option></select>
      <button class="primary sm" data-act="studySel" data-m="flash" ${n ? '' : 'disabled'}>Flashcards</button>
      <button class="accent sm" data-act="studySel" data-m="match" ${n ? '' : 'disabled'}>Match</button>
      <span class="sp"></span>
      <button class="sm danger" data-act="removeSel" ${n ? '' : 'disabled'}>Remove selected</button>
      <button class="sm danger" data-act="clearAll">Clear all lessons</button>
    </div>
    <div class="lessons">${lessonsHtml}</div>` : '<div class="card empty">Nothing here yet &#8212; import a file above.</div>'}`;
  wireDrop();
}

function wireDrop() {
  const drop = $('#drop'), fin = $('#fileIn');
  fin.onchange = () => { if (fin.files.length) importFiles(Array.from(fin.files)); };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) importFiles(Array.from(e.dataTransfer.files)); });
}

async function newGroupWith(ids) {
  const name = await ask({ title: 'New group', message: 'Give the group a name.', input: '', ok: 'Create' });
  if (!name) return null;
  let g = db.groups.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!g) { g = { id: uid(), name, lessonIds: [] }; db.groups.push(g); }
  ids.forEach((id) => { if (!g.lessonIds.includes(id)) g.lessonIds.push(id); });
  save(); return g;
}
function dropLessons(ids) {
  const set = new Set(ids);
  db.lessons = db.lessons.filter((l) => !set.has(l.id));
  db.groups.forEach((g) => { g.lessonIds = g.lessonIds.filter((id) => !set.has(id)); });
  ids.forEach((id) => selected.delete(id));
  pruneScores(ids);
  if (session && session.ids.some((id) => set.has(id))) session = null;
  save();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  const act = el.dataset.act;
  const lid = el.closest('[data-l]')?.dataset.l, gid = el.closest('[data-g]')?.dataset.g;
  const group = gid && db.groups.find((g) => g.id === gid);
  switch (act) {
    case 'browse': $('#fileIn').click(); break;
    case 'editLesson': startEdit(lid); break;
    case 'studyLesson': startSession(lessonById(lid).name, [lid], el.dataset.m); break;
    case 'studyGroup': startSession(group.name, group.lessonIds.filter(lessonById), el.dataset.m); break;
    case 'studySel': startSession(`${plural(selected.size, 'lesson')} selected`, db.lessons.filter((l) => selected.has(l.id)).map((l) => l.id), el.dataset.m); break;
    case 'removeLesson': {
      const l = lessonById(lid);
      if (await ask({ title: 'Remove lesson?', message: `\u201C${l.name}\u201D will be deleted from this browser.`, ok: 'Remove', danger: true })) { dropLessons([lid]); render(); toast('Lesson removed.'); }
      break; }
    case 'removeSel': {
      if (await ask({ title: `Remove ${plural(selected.size, 'lesson')}?`, message: 'They will be deleted from this browser.', ok: 'Remove', danger: true })) { const n = selected.size; dropLessons([...selected]); render(); toast(`${plural(n, 'lesson')} removed.`); }
      break; }
    case 'clearAll':
      if (await ask({ title: 'Clear all lessons?', message: `This deletes all ${plural(db.lessons.length, 'lesson')} and ${plural(db.groups.length, 'group')} saved in this browser. You can re-import your files any time.`, ok: 'Clear everything', danger: true })) {
        db = { lessons: [], groups: [], scores: {} }; selected.clear(); session = null; save(); go('library'); toast('All lessons cleared.');
      }
      break;
    case 'newGroup': { const g = await newGroupWith([...selected]); if (g) { render(); toast(`Group \u201C${g.name}\u201D created.`); } break; }
    case 'renameGroup': { const n = await ask({ title: 'Rename group', input: group.name, ok: 'Rename' }); if (n) { group.name = n; save(); render(); } break; }
    case 'deleteGroup':
      if (await ask({ title: 'Delete group?', message: `\u201C${group.name}\u201D will be deleted. Its lessons stay in your library.`, ok: 'Delete group', danger: true })) { db.groups = db.groups.filter((g) => g !== group); save(); render(); }
      break;
    case 'ungroup': group.lessonIds = group.lessonIds.filter((id) => id !== lid); save(); render(); break;
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'select') { const id = el.closest('[data-l]').dataset.l; el.checked ? selected.add(id) : selected.delete(id); render(); }
  if (el.dataset.act === 'selectAll') { el.checked ? db.lessons.forEach((l) => selected.add(l.id)) : selected.clear(); render(); }
  if (el.dataset.act === 'addToGroup' && el.value) {
    const ids = [...selected]; let g;
    if (el.value === '__new') g = await newGroupWith(ids);
    else { g = db.groups.find((x) => x.id === el.value); ids.forEach((id) => { if (!g.lessonIds.includes(id)) g.lessonIds.push(id); }); save(); }
    if (g) toast(`Added ${plural(ids.length, 'lesson')} to \u201C${g.name}\u201D.`);
    render();
  }
});

/* ---------- lesson editor ---------- */
let edit = null;
function startEdit(id) {
  const l = lessonById(id); if (!l) return;
  edit = { id, name: l.name, cards: l.cards.map((c) => ({ ...c })), filter: '', dirty: false };
  go('edit');
}
function editRows() {
  const f = edit.filter.toLowerCase();
  return edit.cards.map((c, i) => `<div class="erow" data-i="${i}" ${f && !(`${c.w} ${c.f} ${c.d}`.toLowerCase().includes(f)) ? 'hidden' : ''}>
    <span class="n">${i + 1}</span><input data-k="w" value="${esc(c.w)}" placeholder="word" aria-label="Word ${i + 1}">
    <input data-k="f" value="${esc(c.f)}" placeholder="form" aria-label="Form ${i + 1}"><input data-k="d" value="${esc(c.d)}" placeholder="definition" aria-label="Definition ${i + 1}">
    <button class="ghost danger" data-ed="del" title="Delete this word" aria-label="Delete word ${i + 1}">&#215;</button></div>`).join('');
}
function renderEdit() {
  if (!edit || !lessonById(edit.id)) { edit = null; return go('library'); }
  $('#main').innerHTML = `
    <div class="card ed-head">
      <button data-ed="back">&#9666; Library</button>
      <input class="nm" id="ename" value="${esc(edit.name)}" aria-label="Lesson name" placeholder="Lesson name">
      <span class="muted" id="ecount"></span>
      <input id="efilter" type="search" placeholder="Filter words&#8230;" value="${esc(edit.filter)}" aria-label="Filter words">
      <span class="sp"></span>
      <button data-ed="add">&#65291; Add word</button><button data-ed="cancel">Cancel</button><button class="accent" data-ed="save">Save changes</button>
    </div>
    <div class="ed-table"><div class="erow hd"><span></span><span>Word</span><span>Form</span><span>Definition</span><span></span></div><div id="erows">${editRows()}</div></div>`;
  editCount();
}
function editCount() { const e = $('#ecount'); if (e) e.textContent = plural(edit.cards.length, 'word'); }
async function leaveEdit() {
  if (edit.dirty && !(await ask({ title: 'Discard changes?', message: 'Your edits to this lesson have not been saved.', ok: 'Discard', danger: true }))) return;
  edit = null; go('library');
}
function saveEdit() {
  const name = $('#ename').value.replace(/\s+/g, ' ').trim();
  if (!name) { $('#ename').focus(); return toast('Give the lesson a name.'); }
  if (db.lessons.some((l) => l.id !== edit.id && l.name.toLowerCase() === name.toLowerCase())) return toast('Another lesson already has that name.');
  const cards = edit.cards.map((c) => ({ w: clean(c.w), f: clean(c.f), d: clean(c.d) })).filter((c) => c.w || c.f || c.d);
  const bad = cards.findIndex((c) => !c.w || !c.d);
  if (bad >= 0) {
    const rowsAll = edit.cards.filter((c) => clean(c.w) || clean(c.f) || clean(c.d));
    const idx = edit.cards.indexOf(rowsAll[bad]); const row = $(`.erow[data-i="${idx}"]`);
    row?.hidden && (row.hidden = false);
    $$('input', row).forEach((inp) => inp.classList.toggle('bad', !clean(inp.value) && inp.dataset.k !== 'f'));
    row?.scrollIntoView({ block: 'center' }); return toast('Every word needs both a word and a definition (or delete the row).');
  }
  if (!cards.length) return toast('A lesson needs at least one word. Use \u201CRemove\u201D in the library to delete it instead.');
  const l = lessonById(edit.id), oldName = l.name;
  if (JSON.stringify(l.cards) !== JSON.stringify(cards)) pruneScores([l.id]); // words changed => old scores no longer comparable
  l.name = name; l.cards = cards;
  if (session && session.ids.includes(l.id)) { session.cards = cardsOf(session.ids); fc = null; }
  save(); edit = null; go('library'); toast(oldName === name ? 'Lesson saved.' : `Lesson saved as \u201C${name}\u201D.`);
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ed]'); if (!b || view !== 'edit' || !edit) return;
  const a = b.dataset.ed;
  if (a === 'back' || a === 'cancel') leaveEdit();
  else if (a === 'save') saveEdit();
  else if (a === 'add') {
    edit.filter = ''; edit.cards.push({ w: '', f: '', d: '' }); edit.dirty = true; $('#efilter').value = ''; $('#erows').innerHTML = editRows(); editCount();
    const rows = $$('.erow[data-i]'); const last = rows[rows.length - 1]; last.scrollIntoView({ block: 'center' }); $('input', last).focus();
  } else if (a === 'del') {
    const i = +b.closest('.erow').dataset.i; edit.cards.splice(i, 1); edit.dirty = true; $('#erows').innerHTML = editRows(); editCount();
  }
});
document.addEventListener('input', (e) => {
  if (view !== 'edit' || !edit) return;
  const t = e.target;
  if (t.id === 'ename') { edit.name = t.value; edit.dirty = true; }
  else if (t.id === 'efilter') { edit.filter = t.value; const f = t.value.toLowerCase(); $$('#erows .erow').forEach((r) => { const c = edit.cards[+r.dataset.i]; r.hidden = !!f && !(`${c.w} ${c.f} ${c.d}`.toLowerCase().includes(f)); }); }
  else if (t.dataset.k) { edit.cards[+t.closest('.erow').dataset.i][t.dataset.k] = t.value; edit.dirty = true; t.classList.remove('bad'); }
});

/* ---------- flashcards ---------- */
let fc = null;
function renderFlash() {
  if (!session) return go('library');
  if (!fc || fc.src !== session) fc = { src: session, deck: session.cards.slice(), i: 0, flipped: false, know: new Set(), learn: new Set(), shuffled: false, hint: false, recorded: false, review: false, result: null };
  const main = $('#main');
  main.innerHTML = `
    <div class="sbar"><h2>${esc(session.title)}</h2>
      <div class="seg" role="group" aria-label="Show first"><button data-fc="side-w" class="${prefs.side === 'w' ? 'on' : ''}">Word first</button><button data-fc="side-d" class="${prefs.side === 'd' ? 'on' : ''}">Definition first</button></div>
      <button data-fc="shuffle" class="${fc.shuffled ? 'primary' : ''}">&#8644; Shuffle</button>
      <button data-fc="match">Play Match &#9656;</button></div>
    <div class="fc-wrap" id="fcArea"></div>`;
  drawFlash();
}
function faceHtml(c, side, cls, extra = '') {
  const isWord = side === 'w';
  const text = isWord ? c.w : c.d;
  return `<div class="face ${cls}">${isWord ? `<button class="say" data-fc="say" title="Pronounce (Shift)" aria-label="Pronounce (Shift)">&#128266;</button>` : ''}<div class="txt ${text.length > 40 ? 'long' : ''}">${esc(text)}${isWord && c.f ? `<span class="frm">${esc(c.f)}</span>` : ''}</div>${extra}</div>`;
}
function drawFlash() {
  const area = $('#fcArea'); if (!area) return;
  const n = fc.deck.length;
  if (fc.i >= n) {
    area.innerHTML = `<div class="card fc-done"><div class="big">Deck finished &#127881;</div>
      <div>${fc.know.size} known &#183; ${fc.learn.size} still learning</div>${flashScoreLine()}
      <div class="row" style="justify-content:center">${fc.learn.size ? `<button class="accent" data-fc="reviewLearn">Review ${fc.learn.size} still learning</button>` : ''}<button class="primary" data-fc="restart">Start over</button><button data-fc="match">Play Match &#9656;</button></div></div>`;
    return;
  }
  const c = fc.deck[fc.i], front = prefs.side, back = front === 'w' ? 'd' : 'w';
  const ans = back === 'w' ? c.w : c.d, hint = fc.hint ? `<div class="hintbadge">Starts with &#8220;${esc([...ans.trim()][0] || '')}&#8221;</div>` : '';
  area.innerHTML = `
    <div class="progress"><i style="width:${(fc.i / n) * 100}%"></i></div>
    <div class="fc-count"><span>${fc.i + 1} / ${n}</span><span>&#10003; ${fc.know.size}</span><span>&#10007; ${fc.learn.size}</span></div>
    <div class="scene ${fc.flipped ? 'flipped' : ''}" id="scene" tabindex="0" aria-label="Flashcard. Press F to flip."><div class="fc">${faceHtml(c, front, 'front', hint)}${faceHtml(c, back, 'back')}</div></div>
    <div class="fc-ctl"><button data-fc="prev" ${fc.i === 0 ? 'disabled' : ''} aria-label="Previous">&#8592;</button>
      <button class="danger" data-fc="learn">&#10007; Still learning<kbd>&#8595;</kbd></button><button class="know" data-fc="know">&#10003; I know it<kbd>&#8593;</kbd></button>
      <button data-fc="next" aria-label="Next">&#8594;</button></div>
    <div class="fc-hint">Click the card or press <kbd>F</kbd> to flip &#183; <kbd>&#8592;</kbd><kbd>&#8594;</kbd> move &#183; <kbd>/</kbd> hint &#183; <kbd>Shift</kbd> read aloud &#183; <kbd>'</kbd> swap sides &#183; <kbd>Space</kbd> Match &#183; <kbd>?</kbd> button lists every key</div>`;
}
/* A finished full run is scored as known / all cards; "review still learning" runs are not scored. */
function flashScoreLine() {
  if (fc.review) return '';
  if (!fc.recorded) {
    const n = fc.deck.length, acc = n ? fc.know.size / n : 0, s = scoreBucket(), prev = s.flash || null;
    if (!prev || acc > prev.acc) { s.flash = { acc, known: fc.know.size, total: n, date: Date.now() }; save(); }
    fc.recorded = true; fc.result = { acc, prev };
  }
  const { acc, prev } = fc.result;
  if (!prev) return `<div class="scoreline">Accuracy ${pct(acc)}% &#183; first score saved</div>`;
  if (acc > prev.acc) return `<div class="scoreline">New best! ${pct(acc)}% (was ${pct(prev.acc)}%)</div>`;
  if (acc === prev.acc) return `<div class="scoreline">Accuracy ${pct(acc)}% &#183; same as your best</div>`;
  return `<div class="scoreline">Accuracy ${pct(acc)}% &#183; your best is ${pct(prev.acc)}%</div>`;
}
function flashStep(d) {
  const j = clamp(fc.i + d, 0, fc.deck.length);
  if (j < fc.i) { const c = fc.deck[j]; fc.know.delete(c); fc.learn.delete(c); fc.recorded = false; } // stepping back undoes that card's mark
  fc.i = j; fc.flipped = false; fc.hint = false; drawFlash(); }
function flashMark(kind) {
  if (fc.i >= fc.deck.length) return;
  const c = fc.deck[fc.i];
  if (kind === 'know') { fc.learn.delete(c); fc.know.add(c); } else { fc.know.delete(c); fc.learn.add(c); }
  flashStep(1);
}
function flashFlip() { if (fc.i >= fc.deck.length) return; fc.flipped = !fc.flipped; $('#scene')?.classList.toggle('flipped', fc.flipped); }
function flashHint() {
  if (fc.i >= fc.deck.length) return;
  if (fc.flipped) return toast('The hint is for the front of the card \u2013 flip back first.');
  fc.hint = !fc.hint; drawFlash();
}
function setSide(s) { prefs.side = s; savePrefs(); fc.flipped = false; fc.hint = false; renderFlash(); }
function speak(t) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; u.rate = .9; speechSynthesis.speak(u); } catch (e) {} }
document.addEventListener('click', (e) => {
  if (view !== 'flash') { if (e.target.closest('#scene')) return; }
  const b = e.target.closest('[data-fc]'), scene = e.target.closest('#scene');
  if (b) {
    const a = b.dataset.fc;
    if (a === 'say') { e.stopPropagation(); speak(fc.deck[fc.i].w); return; }
    if (a === 'side-w' || a === 'side-d') setSide(a.slice(-1));
    else if (a === 'shuffle') { fc.deck = shuffle(fc.deck); fc.i = 0; fc.flipped = false; fc.hint = false; fc.shuffled = true; renderFlash(); }
    else if (a === 'match') go('match');
    else if (a === 'prev') flashStep(-1);
    else if (a === 'next') flashStep(1);
    else if (a === 'know') flashMark('know');
    else if (a === 'learn') flashMark('learn');
    else if (a === 'restart') { fc = null; renderFlash(); }
    else if (a === 'reviewLearn') { const d = [...fc.learn]; fc.deck = d; fc.review = true; fc.i = 0; fc.know = new Set(); fc.learn = new Set(); fc.flipped = false; fc.hint = false; renderFlash(); }
    return;
  }
  if (scene && view === 'flash') flashFlip();
});
/* ---------- match (board auto-fits the screen) ---------- */
let game = null, timer = null, ro = null;
function stopGame() { clearInterval(timer); timer = null; game = null; if (ro) ro.disconnect(); }
const poolOf = (cards) => { const sw = new Set(), sd = new Set(); return cards.filter((c) => { const a = c.w.toLowerCase(), b = c.d.toLowerCase(); if (sw.has(a) || sd.has(b)) return false; sw.add(a); sd.add(b); return true; }); };

function renderMatch() {
  if (!session) return go('library');
  const pool = poolOf(session.cards), main = $('#main');
  const maxCards = Math.min(60, pool.length * 2);
  if (pool.length < 2) { main.innerHTML = `<div class="card empty">You need at least 2 distinct words to play Match.</div>`; return; }
  const minCards = Math.min(4, maxCards);
  prefs.count = clamp(Math.round(prefs.count / 2) * 2, minCards, maxCards);
  const quick = [8, 12, 16, 20, 24, 30, 40].filter((v) => v < maxCards);
  main.innerHTML = `
    <section class="card mset">
      <div class="slider"><label for="cnt">Cards: <b id="cntLbl"></b></label>
        <input id="cnt" type="range" min="${minCards}" max="${maxCards}" step="2" value="${prefs.count}">
        <div class="ticks">${quick.map((v) => `<button class="sm" data-cnt="${v}">${v}</button>`).join('')}<button class="sm" data-cnt="${maxCards}">All ${maxCards}</button></div></div>
      <div class="seg"><button data-mode="flip" class="${prefs.mode === 'flip' ? 'on' : ''}">Flip (memory)</button><button data-mode="faceup" class="${prefs.mode === 'faceup' ? 'on' : ''}">Face-up</button></div>
      <button class="accent" id="startBtn">New board</button><button id="toFc">&#9666; Flashcards</button>
      <div class="hud"><span><b id="hBest">&#8212;</b><small>best</small></span><span><b id="hTime">0:00</b><small>time</small></span><span><b id="hMoves">0</b><small>moves</small></span><span><b id="hLeft">0/0</b><small>pairs</small></span></div>
    </section>
    <div class="boardwrap"><div id="board" class="board"></div></div>`;
  const upd = () => { $('#cntLbl').textContent = `${prefs.count} (${prefs.count / 2} pairs)`; };
  upd();
  $('#cnt').oninput = (e) => { prefs.count = +e.target.value; savePrefs(); upd(); };
  $('#cnt').onchange = newGame;
  $('.mset').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cnt) { prefs.count = +b.dataset.cnt; $('#cnt').value = prefs.count; savePrefs(); upd(); newGame(); }
    if (b.dataset.mode) setMode(b.dataset.mode);
  };
  $('#startBtn').onclick = newGame;
  $('#toFc').onclick = () => go('flash');
  if (!ro) ro = new ResizeObserver(() => requestAnimationFrame(layoutBoard));
  ro.observe($('.boardwrap'));
  newGame();
}

function setMode(m) { prefs.mode = m; savePrefs(); $$('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === m)); newGame(); }

/* Choose columns/rows so every card is visible and as large as possible, then shrink text to fit. */
function layoutBoard() {
  const wrap = $('.boardwrap'), board = $('#board');
  if (!wrap || !board || !game) return;
  const W = wrap.clientWidth, H = wrap.clientHeight, n = game.cards.length;
  if (!W || !H) return;
  const gap = clamp(Math.round(Math.min(W, H) / 70), 4, 10);
  let best = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), w = (W - gap * (c - 1)) / c, h = (H - gap * (r - 1)) / r;
    if (w < 8 || h < 8) continue;
    const asp = w / h; let s = w * h;
    if (asp > 2.8 || asp < 0.6) s *= 0.35; else if (asp > 2.1 || asp < 0.85) s *= 0.8;
    if (!best || s > best.s) best = { c, r, w, h, s };
  }
  if (!best) { const c = Math.ceil(Math.sqrt(n)), r = Math.ceil(n / c); best = { c, r, w: W / c, h: H / r }; }
  game.cols = best.c;
  board.style.gridTemplateColumns = `repeat(${best.c}, minmax(0, 1fr))`;
  board.style.gridTemplateRows = `repeat(${best.r}, minmax(0, 1fr))`;
  board.style.gap = gap + 'px';
  const base = clamp(Math.min(best.w * 0.13, best.h * 0.24), 8, 26);
  board.style.setProperty('--fs', base + 'px');
  $$('.tile', board).forEach((t) => {
    const f = $('.front', t), tx = $('.tx', t); let fs = 1;            // em relative to --fs
    tx.style.fontSize = '1em';
    const px = () => fs * base;
    while (fs > 0.5 && (tx.offsetHeight > f.clientHeight - 6 || tx.scrollWidth > f.clientWidth - 4)) { fs -= 0.04; tx.style.fontSize = fs + 'em'; if (px() < 7) break; }
  });
}

function newGame() {
  clearInterval(timer);
  const pool = poolOf(session.cards), k = Math.min(prefs.count / 2, pool.length);
  const faceup = prefs.mode === 'faceup';
  const cards = [];
  shuffle(pool).slice(0, k).forEach((p, i) => { cards.push({ id: i, side: 'w', text: p.w, sub: p.f }); cards.push({ id: i, side: 'd', text: p.d }); });
  game = { cards: shuffle(cards), pairs: k, matched: 0, moves: 0, first: null, lock: false, t0: 0, faceup, cur: null, cols: 1 };
  const board = $('#board');
  board.className = 'board' + (faceup ? ' faceup' : '');
  board.innerHTML = game.cards.map((c, i) => `<button class="tile ${c.side} ${faceup ? 'open' : ''}" data-i="${i}" aria-label="Card ${i + 1}"><span class="in"><span class="back">?</span><span class="front"><span class="tx">${esc(c.text)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span></span></span></button>`).join('');
  $('.win')?.remove();
  $('#hBest').innerHTML = fmtBest(matchBest(prefs.mode, game.pairs));
  hud(); layoutBoard();
  board.onclick = (e) => { const t = e.target.closest('.tile'); if (t) pick(+t.dataset.i, t); };
}
/* keyboard cursor on the board: arrows move, D picks */
function setCursor(i) {
  game.cur = i; $$('.tile.cur').forEach((t) => t.classList.remove('cur'));
  $(`.tile[data-i="${i}"]`)?.classList.add('cur'); $('#board').classList.add('kbd');
}
function moveCursor(key) {
  const n = game.cards.length, isDone = (i) => $(`.tile[data-i="${i}"]`)?.classList.contains('done');
  if (game.cur === null) { for (let i = 0; i < n; i++) if (!isDone(i)) return setCursor(i); return; }
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -game.cols, ArrowDown: game.cols }[key];
  let i = game.cur + step;
  while (i >= 0 && i < n && isDone(i)) i += step;
  if (i >= 0 && i < n) setCursor(i);
}
function chooseCursor() {
  if (game.cur === null) return moveCursor('ArrowRight');
  const t = $(`.tile[data-i="${game.cur}"]`); if (t) pick(game.cur, t);
}
const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
function hud() {
  if (!game) return;
  $('#hTime').textContent = fmtTime(game.t0 ? (game.end || Date.now()) - game.t0 : 0);
  $('#hMoves').textContent = game.moves; $('#hLeft').textContent = `${game.matched}/${game.pairs}`;
}
function pick(i, tile) {
  const g = game; if (!g || g.lock || tile.classList.contains('done')) return;
  if (!g.t0) { g.t0 = Date.now(); timer = setInterval(hud, 40); }
  if (g.first === i) { if (g.faceup) { tile.classList.remove('sel'); g.first = null; } return; }
  if (!g.faceup && tile.classList.contains('open')) return;
  tile.classList.add(g.faceup ? 'sel' : 'open');
  if (g.first === null) { g.first = i; return; }
  const a = g.first, ta = $(`.tile[data-i="${a}"]`), tb = tile;
  g.first = null; g.moves++;
  const ok = g.cards[a].id === g.cards[i].id && g.cards[a].side !== g.cards[i].side;
  if (ok) {
    [ta, tb].forEach((t) => { t.classList.remove('sel'); t.classList.add('done', 'open'); });
    g.matched++; hud();
    if (g.cur !== null && $(`.tile[data-i="${g.cur}"]`)?.classList.contains('done')) { const at = g.cur; moveCursor('ArrowRight'); if (g.cur === at) moveCursor('ArrowLeft'); }
    if (g.matched === g.pairs) finish();
  } else {
    g.lock = true;
    if (g.faceup) [ta, tb].forEach((t) => t.classList.add('wrong'));
    setTimeout(() => { [ta, tb].forEach((t) => { t.classList.remove('wrong', 'sel'); if (!g.faceup) t.classList.remove('open'); }); g.lock = false; }, g.faceup ? 450 : 900);
    hud();
  }
}
function finish() {
  clearInterval(timer); game.end = Date.now(); hud();
  const ms = game.end - game.t0, accR = game.pairs / game.moves, acc = pct(accR);
  // best = highest accuracy, then fastest time; kept separately per mode and board size
  const bk = `${prefs.mode}:${game.pairs}`, sb = scoreBucket(); sb.match = sb.match || {};
  const prev = sb.match[bk] || null, EPS = 1e-9;
  const better = !prev || accR > prev.acc + EPS || (Math.abs(accR - prev.acc) < EPS && ms < prev.ms);
  if (better) { sb.match[bk] = { acc: accR, ms, moves: game.moves, date: Date.now() }; save(); }
  $('#hBest').innerHTML = fmtBest(sb.match[bk]);
  const note = !prev ? 'First score saved' : better ? `New best! (was ${fmtBest(prev)})` : `Your best: ${fmtBest(prev)}`;
  const w = document.createElement('div'); w.className = 'win';
  w.innerHTML = `<div class="card"><div class="big">All matched! &#127881;</div><div>${fmtTime(ms)} &#183; ${plural(game.moves, 'move')} &#183; ${acc}% accuracy</div><div class="scoreline">${note}</div>
    <div class="row" style="justify-content:center"><button class="accent" id="again">Play again</button><button id="toFlash">Flashcards</button></div></div>`;
  const g = game;
  setTimeout(() => { const bw = $('.boardwrap'); if (game !== g || !bw) return; bw.appendChild(w); $('#again').onclick = newGame; $('#toFlash').onclick = () => go('flash'); }, 700);
}

/* ---------- IndexedDB (imported songs & fonts persist in this browser) ---------- */
const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('vocabdesk-files', 1);
    r.onupgradeneeded = () => ['songs', 'fonts'].forEach((s) => r.result.createObjectStore(s, { keyPath: 'id' }));
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (s, m, f) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, m); const r = f(t.objectStore(s)); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { all: (s) => tx(s, 'readonly', (o) => o.getAll()), put: (s, v) => tx(s, 'readwrite', (o) => o.put(v)), del: (s, id) => tx(s, 'readwrite', (o) => o.delete(id)) };
})();

/* ---------- themes & fonts ---------- */
const THEMES = [['pink', 'Pink'], ['blue', 'Blue'], ['orange', 'Orange']]; // swatch colours live in css/style.css (--sw-*)
const BUILTIN_FONTS = [
  { id: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'consolas', label: 'Consolas', css: 'Consolas, "Courier New", monospace' },
  { id: 'pixel', label: '256 Bytes (pixel)', css: '"TwoFiftySixBytes", "Times New Roman", serif' },
];
let customFonts = [];
const allFonts = () => [...BUILTIN_FONTS, ...customFonts];
function applyTheme() {
  if (!THEMES.some((t) => t[0] === prefs.theme)) prefs.theme = 'blue';
  if (prefs.tone !== 'dark') prefs.tone = 'light';
  document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.tone = prefs.tone;
}
function applyFont() {
  const f = allFonts().find((x) => x.id === prefs.font) || BUILTIN_FONTS[0];
  document.documentElement.style.setProperty('--font', f.css);
  (document.fonts?.ready || Promise.resolve()).then(() => requestAnimationFrame(layoutBoard));
}
async function registerFont(rec) {
  const ff = new FontFace('UF_' + rec.id, await rec.blob.arrayBuffer());
  await ff.load(); document.fonts.add(ff);
  const entry = { id: rec.id, label: rec.name, css: `"UF_${rec.id}", "Times New Roman", serif`, custom: true };
  customFonts.push(entry); return entry;
}
async function loadCustomFonts() {
  try { for (const rec of await idb.all('fonts')) { try { await registerFont(rec); } catch (e) {} } } catch (e) {}
  applyFont(); drawSettings();
}
function drawSettings() {
  const p = $('#setPanel'); if (p.hidden) return;
  p.innerHTML = `
    <div><h4>Theme</h4><div class="themes">${THEMES.map(([id, label]) => `<button data-theme="${id}" class="${prefs.theme === id ? 'on' : ''}"><i></i>${label}</button>`).join('')}</div>
      <div class="seg" style="margin-top:.5rem" role="group" aria-label="Light or dark"><button data-tone="light" class="${prefs.tone === 'light' ? 'on' : ''}">&#9728; Light</button><button data-tone="dark" class="${prefs.tone === 'dark' ? 'on' : ''}">&#9790; Dark</button></div></div>
    <div><h4>Font</h4><div class="fontlist">${allFonts().map((f) => `<div class="fi"><button data-font="${f.id}" class="${prefs.font === f.id ? 'on' : ''}" style="font-family:${f.css.replace(/"/g, '&quot;')}">${esc(f.label)}</button>${f.custom ? `<button class="ghost danger sm" data-rmfont="${f.id}" title="Remove font" aria-label="Remove ${esc(f.label)}">&#215;</button>` : ''}</div>`).join('')}</div>
      <div class="row" style="margin-top:.5rem"><button class="sm" id="addFont">&#65291; Add font&#8230;</button><input type="file" id="fontIn" accept=".woff2,.woff,.ttf,.otf" multiple hidden></div>
      <p class="small">Add .woff2, .woff, .ttf or .otf files. They are saved in this browser. Characters a font lacks fall back to Times New Roman.</p></div>`;
}
function toggleSettings(force) {
  const p = $('#setPanel'), open = force === undefined ? p.hidden : force;
  p.hidden = !open; $('#setBtn').setAttribute('aria-expanded', open); if (open) drawSettings();
}
$('#setBtn').onclick = (e) => { e.stopPropagation(); toggleSettings(); };
document.addEventListener('click', (e) => { if (!$('#setPanel').hidden && !e.composedPath().some((n) => n.id === 'setPanel' || n.id === 'setBtn')) { $('#setPanel').hidden = true; $('#setBtn').setAttribute('aria-expanded', 'false'); } });
$('#setPanel').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.theme) { prefs.theme = b.dataset.theme; savePrefs(); applyTheme(); drawSettings(); }
  else if (b.dataset.tone) { prefs.tone = b.dataset.tone; savePrefs(); applyTheme(); drawSettings(); }
  else if (b.dataset.font) { prefs.font = b.dataset.font; savePrefs(); applyFont(); drawSettings(); }
  else if (b.dataset.rmfont) {
    customFonts = customFonts.filter((f) => f.id !== b.dataset.rmfont);
    try { await idb.del('fonts', b.dataset.rmfont); } catch (err) {}
    if (prefs.font === b.dataset.rmfont) { prefs.font = 'times'; savePrefs(); }
    applyFont(); drawSettings();
  } else if (b.id === 'addFont') $('#fontIn').click();
});
$('#setPanel').addEventListener('change', async (e) => {
  if (e.target.id !== 'fontIn') return;
  for (const f of Array.from(e.target.files)) {
    try {
      const rec = { id: uid(), name: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), blob: f };
      const entry = await registerFont(rec);
      try { await idb.put('fonts', rec); } catch (err) { toast('Font added for this session only (browser storage unavailable).'); }
      prefs.font = entry.id; savePrefs(); applyFont(); toast(`Font \u201C${rec.name}\u201D added.`);
    } catch (err) { toast(`Could not use ${f.name}: not a valid font file.`); }
  }
  drawSettings();
});

/* ---------- music ---------- */
const audio = $('#audio'); let tracks = [], cur = -1;
const trackTitle = (s) => { let t = decodeURIComponent(String(s).split('/').pop()).replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim(); return t; };
const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|aac|flac|opus|webm)$/i;

async function loadTracks() {
  const list = [];
  (window.AUDIO_PLAYLIST || []).forEach((t) => { const src = typeof t === 'string' ? t : t.src; list.push({ title: (t && t.title) || trackTitle(src), src: /^(https?:|blob:|\/)/.test(src) ? src : 'audios/' + encodeURI(src), user: false }); });
  try { // works when served by a web server that lists directories (e.g. python -m http.server)
    const r = await fetch('audios/', { cache: 'no-store' });
    if (r.ok && /text\/html/.test(r.headers.get('content-type') || '')) {
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      $$('a', doc).forEach((a) => { const h = a.getAttribute('href') || ''; if (AUDIO_EXT.test(decodeURIComponent(h)) && !/^https?:/.test(h)) { const src = 'audios/' + h.replace(/^.*\//, ''); if (!list.some((t) => decodeURIComponent(t.src) === decodeURIComponent(src))) list.push({ title: trackTitle(h), src, user: false }); } });
    }
  } catch (e) {}
  try { (await idb.all('songs')).forEach((s) => list.push({ id: s.id, title: trackTitle(s.name), src: URL.createObjectURL(s.blob), user: true })); } catch (e) {}
  tracks = list;
  const i = tracks.findIndex((t) => t.src === prefs.track || (t.user && t.id === prefs.trackId));
  selectTrack(i >= 0 ? i : (tracks.length ? 0 : -1), false);
}
function selectTrack(i, play) {
  cur = i;
  if (i < 0 || !tracks[i]) { audio.removeAttribute('src'); $('#plTitle').innerHTML = 'No music &#8212; add songs with &#65291;'; drawMenu(); return; }
  audio.src = tracks[i].src; $('#plTitle').textContent = tracks[i].title;
  prefs.track = tracks[i].user ? '' : tracks[i].src; prefs.trackId = tracks[i].id || ''; savePrefs(); drawMenu();
  if (play) audio.play().catch(() => toast('Could not play \u201C' + tracks[i].title + '\u201D.'));
}
function nextIdx(dir) {
  if (!tracks.length) return -1;
  if (prefs.shuffleTracks && tracks.length > 1 && dir > 0) { let j; do { j = Math.floor(Math.random() * tracks.length); } while (j === cur); return j; }
  return (cur + dir + tracks.length) % tracks.length;
}
function drawMenu() {
  const m = $('#plMenu'); const row = (t, i) => `<div class="mi"><button data-t="${i}" class="${i === cur ? 'cur' : ''}">${i === cur ? '&#9654; ' : ''}${esc(t.title)}</button>${t.user ? `<button class="rm" data-rm="${i}" title="Remove this song" aria-label="Remove ${esc(t.title)}">&#215;</button>` : ''}</div>`;
  const def = tracks.map((t, i) => [t, i]).filter(([t]) => !t.user), usr = tracks.map((t, i) => [t, i]).filter(([t]) => t.user);
  m.innerHTML = (def.length ? `<div class="sub">Default playlist</div>${def.map(([t, i]) => row(t, i)).join('')}` : '')
    + (usr.length ? `<div class="sub">Your songs</div>${usr.map(([t, i]) => row(t, i)).join('')}` : '')
    + `<p>&#65291; in the bar adds songs from your device. Songs you add are saved in this browser and can be removed with &#215;.</p>`;
}
audio.volume = prefs.vol; $('#plVol').value = prefs.vol;
$('#plVol').oninput = (e) => { audio.volume = +e.target.value; prefs.vol = audio.volume; savePrefs(); };
$('#plPlay').onclick = togglePlay;
function nextTrack() { const i = nextIdx(1); if (i >= 0) selectTrack(i, true); }
$('#plNext').onclick = nextTrack;
function prevTrack() { if (audio.currentTime > 3) audio.currentTime = 0; else { const i = nextIdx(-1); if (i >= 0) selectTrack(i, true); } }
$('#plPrev').onclick = prevTrack;
function toggleShuffle() { prefs.shuffleTracks = !prefs.shuffleTracks; $('#plShuffle').setAttribute('aria-pressed', prefs.shuffleTracks); savePrefs(); toast('Shuffle ' + (prefs.shuffleTracks ? 'on' : 'off')); }
$('#plShuffle').onclick = toggleShuffle;
function loopUi() { const b = $('#plLoop'); b.dataset.mode = prefs.loop; b.title = `Repeat: ${prefs.loop} (N)`; b.innerHTML = prefs.loop === 'one' ? '&#8635;1' : '&#8635;'; }
function toggleLoop() { prefs.loop = prefs.loop === 'all' ? 'one' : 'all'; loopUi(); savePrefs(); toast('Repeat: ' + (prefs.loop === 'one' ? 'current song' : 'whole playlist')); }
$('#plLoop').onclick = toggleLoop;
function muteUi() { audio.muted = !!prefs.muted; const b = $('#plMute'); b.innerHTML = prefs.muted ? '&#128263;' : '&#128266;'; b.setAttribute('aria-pressed', !!prefs.muted); b.title = prefs.muted ? 'Unmute (M)' : 'Mute (M)'; }
function togglePlay() { if (cur < 0) return toast('No music yet \u2014 add songs with \uFF0B.'); if (audio.paused) audio.play().catch(() => toast('Could not play this file.')); else audio.pause(); }
function toggleMute() { prefs.muted = !prefs.muted; muteUi(); savePrefs(); toast(prefs.muted ? 'Music muted' : 'Music unmuted'); }
$('#plMute').onclick = toggleMute;
function toggleList() { if (prefs.folded) setFolded(false); $('#plMenu').hidden = !$('#plMenu').hidden; }
$('#plList').onclick = toggleList;
$('#plMenu').onclick = async (e) => {
  const rm = e.target.closest('[data-rm]'), b = e.target.closest('[data-t]');
  if (rm) {
    const i = +rm.dataset.rm, t = tracks[i], wasCur = i === cur, wasPlaying = !audio.paused;
    try { await idb.del('songs', t.id); } catch (err) {}
    URL.revokeObjectURL(t.src); tracks.splice(i, 1);
    if (wasCur) { cur = -1; audio.pause(); selectTrack(tracks.length ? Math.min(i, tracks.length - 1) : -1, wasPlaying && tracks.length > 0); }
    else { if (i < cur) cur--; drawMenu(); }
    toast(`Removed \u201C${t.title}\u201D.`);
  } else if (b) { selectTrack(+b.dataset.t, true); $('#plMenu').hidden = true; }
};
$('#plFiles').onchange = async (e) => {
  const files = Array.from(e.target.files).filter((f) => f.type.startsWith('audio') || AUDIO_EXT.test(f.name)); e.target.value = '';
  let session_only = false, first = -1;
  for (const f of files) {
    const rec = { id: uid(), name: f.name, blob: f };
    try { await idb.put('songs', rec); } catch (err) { session_only = true; }
    tracks.push({ id: rec.id, title: trackTitle(f.name), src: URL.createObjectURL(f), user: true }); if (first < 0) first = tracks.length - 1;
  }
  if (!files.length) return toast('Please choose audio files (.mp3, .ogg, .wav, .m4a\u2026).');
  toast(`${plural(files.length, 'song')} added${session_only ? ' for this session only' : ''}.`);
  if (cur < 0) selectTrack(first, true); else drawMenu();
};
$('#plToggle').onclick = () => setFolded(false);
audio.onplay = () => { $('#plPlay').innerHTML = '&#9208;'; };
audio.onpause = () => { $('#plPlay').innerHTML = '&#9654;'; };
audio.onended = () => { if (prefs.loop === 'one') { audio.currentTime = 0; audio.play(); } else { const i = nextIdx(1); if (i >= 0) selectTrack(i, true); } };
audio.onerror = () => { if (cur >= 0 && audio.getAttribute('src')) toast('Could not load \u201C' + (tracks[cur]?.title || '') + '\u201D.'); };
$('#plShuffle').setAttribute('aria-pressed', prefs.shuffleTracks);
loopUi(); muteUi();
document.addEventListener('click', (e) => { if (!e.composedPath().some((n) => n.id === 'plMenu' || n.id === 'plList')) $('#plMenu').hidden = true; });
function setFolded(f) { prefs.folded = !!f; savePrefs(); $('#player').classList.toggle('folded', prefs.folded); if (prefs.folded) $('#plMenu').hidden = true; }
$('#player').classList.toggle('folded', !!prefs.folded);
$('#plHide').onclick = () => setFolded(true);

/* ---------- credits ---------- */
const credit = $('#credit');
function openCredit() { credit.hidden = false; $('#credit-close').focus(); }
function closeCredit() { credit.hidden = true; $('#brand').focus(); }
$('#brand').onclick = openCredit;
$('#credit-close').onclick = closeCredit;
credit.addEventListener('click', (e) => { if (e.target === credit) closeCredit(); });

/* ---------- keyboard guide ---------- */
const guide = $('#guide');
const GUIDE = [
  ['flash', 'Flashcards', [[['\u2191'], 'I know it'], [['\u2193'], 'Still learning'], [['\u2190', '\u2192'], 'Previous / next card'], [['F'], 'Flip the card'], [['Shift'], 'Read the word aloud'], [['/'], 'Hint: first letter (like Quizlet)'], [["'"], 'Word first \u21C4 definition first'], [['Space'], 'Switch to Match']]],
  ['match', 'Match', [[['\u2190', '\u2191', '\u2193', '\u2192'], 'Move between cards'], [['D'], 'Choose the card'], [['R'], 'New board'], [["'"], 'Flip (memory) \u21C4 Face-up'], [['Space'], 'Switch to Flashcards']]],
  ['music', 'Music', [[['M'], 'Mute / unmute'], [['K'], 'Play / pause the music'], [['N'], 'Repeat mode (all \u21C4 one)'], [['B'], 'Shuffle on / off'], [[','], 'Previous song'], [['.'], 'Next song'], [['H'], 'Hide / show the player'], [['L'], 'Show / hide the track list']]],
  ['general', 'Anywhere', [[['S'], 'Open / close settings'], [['\\'], 'Back to the library'], [['Esc'], 'Close a popup']]],
];
function openGuide() {
  toggleSettings(false);
  $('#guideBody').innerHTML = GUIDE.map(([id, title, rows]) => `<section class="gsec ${id === view ? 'on' : ''}"><h3>${title}</h3>${rows.map(([ks, t]) => `<div class="krow"><span>${ks.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span><span>${esc(t)}</span></div>`).join('')}</section>`).join('');
  guide.hidden = false; $('#guide-close').focus();
}
function closeGuide() { guide.hidden = true; $('#guideBtn').focus(); }
$('#guideBtn').onclick = openGuide;
$('#guide-close').onclick = closeGuide;
guide.addEventListener('click', (e) => { if (e.target === guide) closeGuide(); });
const overlayOpen = () => !credit.hidden || !guide.hidden;
function closeOverlays() { if (!credit.hidden) closeCredit(); else if (!guide.hidden) closeGuide(); else toggleSettings(false); }

/* ---------- keyboard shortcuts ---------- */
const CODE_KEYS = { Quote: "'", Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Space: ' ' }; // physical keys, so they work on any layout
const keyOf = (e) => CODE_KEYS[e.code] || (e.key.length === 1 ? e.key.toLowerCase() : e.key);
const isTyping = (t) => !!t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|file)$/.test(t.type)));
const R = (fn) => { fn.rep = true; return fn; }; // R(...) = allowed to repeat while the key is held
const KEYS = {
  global: {
    s: () => toggleSettings(),
    '\\': () => { if (view === 'edit') leaveEdit(); else if (view !== 'library') go('library'); },
    m: toggleMute, k: togglePlay, n: toggleLoop, b: toggleShuffle, ',': prevTrack, '.': nextTrack,
    h: () => setFolded(!prefs.folded), l: () => toggleList(),
  },
  flash: {
    ArrowUp: () => flashMark('know'), ArrowDown: () => flashMark('learn'),
    ArrowLeft: R(() => flashStep(-1)), ArrowRight: R(() => flashStep(1)),
    f: flashFlip, '/': flashHint, "'": () => setSide(prefs.side === 'w' ? 'd' : 'w'), ' ': () => go('match'),
  },
  match: {
    ArrowUp: R(() => moveCursor('ArrowUp')), ArrowDown: R(() => moveCursor('ArrowDown')),
    ArrowLeft: R(() => moveCursor('ArrowLeft')), ArrowRight: R(() => moveCursor('ArrowRight')),
    d: chooseCursor, r: () => newGame(), "'": () => setMode(prefs.mode === 'flip' ? 'faceup' : 'flip'), ' ': () => go('flash'),
  },
};
let shiftClean = false; // Shift pressed and released on its own => read the word
const blocked = (e) => e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || $('#dlg').open || overlayOpen();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') { if (!e.repeat) shiftClean = true; return; }
  shiftClean = false;
  if (e.key === 'Escape') return closeOverlays();
  if (blocked(e)) return;
  const k = keyOf(e);
  if (e.target.type === 'range' && k.startsWith('Arrow')) return;
  const fn = (view === 'flash' && fc && KEYS.flash[k]) || (view === 'match' && game && KEYS.match[k]) || KEYS.global[k];
  if (!fn) return;
  e.preventDefault();
  if (!e.repeat || fn.rep) fn();
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    const ok = shiftClean && view === 'flash' && fc && fc.i < fc.deck.length && !blocked(e); shiftClean = false;
    if (ok) speak(fc.deck[fc.i].w);
  } else if (e.key === ' ' && (view === 'flash' || view === 'match') && !blocked(e)) e.preventDefault(); // stop Space from also "clicking" a focused button
});
window.addEventListener('blur', () => { shiftClean = false; });
document.addEventListener('mousedown', () => { shiftClean = false; });

/* ---------- boot ---------- */
applyTheme(); applyFont();
render();
loadTracks();
loadCustomFonts();
