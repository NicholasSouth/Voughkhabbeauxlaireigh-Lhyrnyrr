/* Tiny dependency-free .xlsx / .csv reader.
   Returns sheets as { name, rows: string[][], merges: [{r1,c1,r2,c2}] } (0-based). */
(function (root) {
  const td = new TextDecoder('utf-8');

  async function inflateRaw(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a valid .xlsx file');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const entries = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      entries[name] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), lho: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    return async function get(name) {
      const f = entries[name];
      if (!f) return null;
      const ln = dv.getUint16(f.lho + 26, true), le = dv.getUint16(f.lho + 28, true);
      const start = f.lho + 30 + ln + le;
      const data = u8.subarray(start, start + f.csize);
      const raw = f.method === 0 ? data : await inflateRaw(data);
      return td.decode(raw);
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const cellRef = (ref) => { const m = /^([A-Z]+)(\d+)$/i.exec(ref); return m ? { c: colIdx(m[1]), r: +m[2] - 1 } : null; };
  const attrAny = (el, local) => { for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value; return null; };

  async function readXlsx(buf) {
    const get = unzip(buf);
    const wbXml = await get('xl/workbook.xml');
    if (!wbXml) throw new Error('Not a valid .xlsx file');
    const relsXml = (await get('xl/_rels/workbook.xml.rels')) || '';
    const rels = {};
    if (relsXml) all(xml(relsXml), 'Relationship').forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });

    const shared = [];
    const ssXml = await get('xl/sharedStrings.xml');
    if (ssXml) all(xml(ssXml), 'si').forEach((si) => {
      shared.push(all(si, 't').filter((t) => !t.parentNode || t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
    });

    const sheets = [];
    const metas = all(xml(wbXml), 'sheet');
    for (let i = 0; i < metas.length; i++) {
      const rid = attrAny(metas[i], 'id');
      let target = rels[rid] || `worksheets/sheet${i + 1}.xml`;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.?\//, '');
      const sx = await get(target);
      if (!sx) continue;
      const doc = xml(sx);
      const rows = [];
      all(doc, 'c').forEach((c) => {
        const pos = cellRef(c.getAttribute('r') || '');
        if (!pos) return;
        const t = c.getAttribute('t');
        const v = all(c, 'v')[0];
        let val = '';
        if (t === 's') val = shared[+(v ? v.textContent : -1)] ?? '';
        else if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent).join('');
        else if (v) val = v.textContent;
        (rows[pos.r] = rows[pos.r] || [])[pos.c] = val;
      });
      const merges = all(doc, 'mergeCell').map((m) => {
        const [a, b] = (m.getAttribute('ref') || '').split(':');
        const p1 = cellRef(a), p2 = cellRef(b || a);
        return p1 && p2 ? { r1: p1.r, c1: p1.c, r2: p2.r, c2: p2.c } : null;
      }).filter(Boolean);
      sheets.push({ name: metas[i].getAttribute('name') || `Sheet${i + 1}`, rows, merges });
    }
    return sheets;
  }

  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return [{ name: '', rows, merges: [] }];
  }

  root.Reader = { readXlsx, parseCsv };
})(window);
