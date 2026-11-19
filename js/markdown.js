// Tiny, safe markdown renderer for card answers:
// paragraphs, "- " lists, simple pipe tables, **bold**, `code`, [placeholders].
// All text is HTML-escaped first, so card content can never inject markup.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  let h = esc(s);
  h = h.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/`([^`]+?)`/g, '<code>$1</code>');
  h = h.replace(/\[([^\]\n]{1,120})\]/g, '<span class="ph">[$1]</span>');
  return h;
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++; }
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      const [head, ...rest] = body;
      out.push('<table><thead><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + rest.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    if (/^\s*- /.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*- /.test(lines[i])) { items.push(lines[i].replace(/^\s*- /, '')); i++; }
      out.push('<ul>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ul>');
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*- /.test(lines[i]) && !lines[i].trim().startsWith('|')) {
      para.push(lines[i]); i++;
    }
    const text = para.map(inline).join('<br>');
    const isBr = para[0].trim().startsWith('🇧🇷');
    out.push(isBr ? `<p class="br-note">${text}</p>` : `<p>${text}</p>`);
  }
  return out.join('');
}
