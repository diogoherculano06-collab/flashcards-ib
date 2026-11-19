// IB Flashcards — UI and study flow.
import * as db from './db.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import { schedule, previewLabel, isDue, newProgress, GRADE_LABELS } from './srs.js';
import { renderMarkdown, esc } from './markdown.js';
import { streak, deckStats, weakest } from './stats.js';
import { parseTs, dayKey, startOfDay, shuffle, seededShuffle, uuid, deviceName, fmtPct, fmtDateTime } from './util.js';
import { APP_VERSION, DEFAULT_NEW_PER_DAY, EXAM_SIZE, EXAM_SECONDS } from './config.js';

const DECK_ORDER = ['Finanças', 'Contabilidade', 'Equity Value & Enterprise Value', 'Valuation', 'DCF', 'M&A', 'LBO', 'Fit'];
const TYPES = ['conceito', 'cálculo', 'fit'];
const TYPE_LABEL = { conceito: 'Conceito', 'cálculo': 'Cálculo', fit: 'Fit' };
const LANG_LABEL = { pt: 'PT', en: 'EN' };

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const S = {
  view: 'boot', bootMsg: 'Carregando…',
  cards: [], byId: new Map(), progress: new Map(), reviews: [],
  newPerDay: DEFAULT_NEW_PER_DAY,
  session: null, summary: null, examResult: null,
  filters: null, examDecks: null, examIncludeFit: false,
  login: { step: 'email', email: '', msg: '', err: false, busy: false },
  swReg: null, updateReady: false
};

// ---------------------------------------------------------------- data

function deckList() {
  const decks = [...new Set(S.cards.map((c) => c.deck))];
  return decks.sort((a, b) => {
    const ia = DECK_ORDER.indexOf(a), ib = DECK_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'pt');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

async function loadLocal() {
  const [cards, prog, revs] = await Promise.all([db.getAll('cards'), db.getAll('progress'), db.getAll('reviews')]);
  S.cards = cards.filter((c) => c.active !== false);
  S.byId = new Map(S.cards.map((c) => [c.id, c]));
  S.progress = new Map(prog.map((p) => [p.card_id, p]));
  S.reviews = revs;
  S.newPerDay = await db.getMeta('newPerDay', DEFAULT_NEW_PER_DAY);
}

function dueCards() {
  return S.cards
    .filter((c) => isDue(S.progress.get(c.id)))
    .sort((a, b) => parseTs(S.progress.get(a.id).due_at) - parseTs(S.progress.get(b.id).due_at));
}

function newIntroducedToday() {
  const today = dayKey(new Date());
  const first = new Map();
  for (const r of S.reviews) {
    const k = dayKey(parseTs(r.reviewed_at));
    if (!first.has(r.card_id) || k < first.get(r.card_id)) first.set(r.card_id, k);
  }
  let n = 0;
  for (const k of first.values()) if (k === today) n++;
  return n;
}

function newCardsForToday() {
  const remaining = Math.max(0, S.newPerDay - newIntroducedToday());
  if (!remaining) return [];
  const unseen = S.cards.filter((c) => !S.progress.has(c.id));
  return seededShuffle(unseen, dayKey(new Date())).slice(0, remaining);
}

function errorCards() {
  return S.cards.filter((c) => {
    const p = S.progress.get(c.id);
    return p && (p.last_grade === 0 || p.lapses >= 2);
  });
}

// ---------------------------------------------------------------- rendering helpers

function syncLabel(st) {
  const n = st.pending;
  const rev = n === 1 ? '1 revisão pendente' : `${n} revisões pendentes`;
  switch (st.state) {
    case 'offline': return n ? `Offline · ${rev}` : 'Offline';
    case 'syncing': return 'Sincronizando…';
    case 'error': return n ? `Erro · ${n} ${n === 1 ? 'pendente' : 'pendentes'}` : 'Erro ao sincronizar';
    case 'ok': return n ? rev : 'Sincronizado';
    default: return n ? rev : 'Sincronizado';
  }
}

function header() {
  const st = sync.getStatus();
  return `<header class="top">
    <div class="brand">IB Flashcards</div>
    <button class="sync ${st.state}" id="sync" data-action="sync" title="Sincronizar agora">${esc(syncLabel(st))}</button>
  </header>`;
}

function nav(active) {
  const item = (view, ico, label) =>
    `<button data-action="go" data-view="${view}" ${active === view ? 'aria-current="page"' : ''}><span class="ico" aria-hidden="true">${ico}</span>${label}</button>`;
  return `<nav class="nav" aria-label="Navegação">${item('home', '⌂', 'Início')}${item('stats', '▤', 'Estatísticas')}${item('settings', '⚙', 'Ajustes')}</nav>`;
}

function page(active, body, opts = {}) {
  return `<div class="shell">${header()}<main class="${opts.mainClass || ''}">${body}</main>${opts.noNav ? '' : nav(active)}</div>`;
}

function chip(group, value, label, pressed) {
  return `<button class="chip" data-action="chip" data-group="${group}" data-value="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
}

function toast(html, ms = 4000) {
  $toast.innerHTML = html;
  $toast.hidden = false;
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
}

// ---------------------------------------------------------------- views

function viewBoot() {
  return `<div class="boot"><div class="spinner" aria-hidden="true"></div><p>${esc(S.bootMsg)}</p></div>`;
}

function viewLogin() {
  const L = S.login;
  const msg = L.msg ? `<div class="msg ${L.err ? 'err' : ''}">${esc(L.msg)}</div>` : '';
  const body = L.step === 'email'
    ? `<form data-form="email">
        <label class="field"><span>E-mail</span>
          <input type="email" name="email" required autocomplete="email" inputmode="email" value="${esc(L.email)}" placeholder="voce@exemplo.com"></label>
        ${msg}
        <button class="btn primary big" type="submit" ${L.busy ? 'disabled' : ''}>${L.busy ? 'Enviando…' : 'Enviar e-mail de acesso'}</button>
      </form>`
    : `<form data-form="code">
        <p>Enviamos um e-mail para <strong>${esc(L.email)}</strong>.</p>
        <p class="muted small">No computador ou no Android: abra o e-mail e toque no botão. No iPhone com o app instalado: toque e segure o botão → Copiar link, e cole abaixo (assim o login fica dentro do app). Se o e-mail tiver um código de 6 dígitos, digite o código.</p>
        <label class="field"><span>Link ou código</span>
          <input type="text" name="code" required autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="https://… ou 123456"></label>
        ${msg}
        <button class="btn primary big" type="submit" ${L.busy ? 'disabled' : ''}>${L.busy ? 'Verificando…' : 'Entrar'}</button>
        <div class="row"><button class="btn link" type="button" data-action="login-resend">Reenviar e-mail</button>
        <button class="btn link" type="button" data-action="login-change">Usar outro e-mail</button></div>
      </form>`;
  return `<main><div class="login panel">
    <h1>IB Flashcards</h1>
    <p class="muted">Entre pelo e-mail de acesso. Depois do primeiro login, o app funciona sem internet.</p>
    ${body}</div></main>`;
}

function viewHome() {
  if (!S.cards.length) {
    return page('home', `<div class="center"><p>Nenhum card baixado ainda.</p>
      <p class="muted">Conecte-se à internet e toque em sincronizar.</p>
      <button class="btn primary" data-action="sync">Sincronizar agora</button></div>`);
  }
  const due = dueCards().length;
  const fresh = newCardsForToday().length;
  const errs = errorCards().length;
  const st = streak(S.reviews);
  const total = due + fresh;
  return page('home', `
    <section class="panel hero">
      <div class="big-num">${total}</div>
      <div class="sub">${due} para revisar · ${fresh} novos hoje</div>
      <button class="btn primary big" data-action="start-daily" ${total ? '' : 'disabled'}>${total ? 'Revisão do dia' : 'Tudo em dia ✓'}</button>
      <div class="streak">${st ? `🔥 ${st} ${st === 1 ? 'dia seguido' : 'dias seguidos'}` : 'Comece sua sequência hoje'}</div>
    </section>
    <div class="grid2">
      <button class="btn tile" data-action="go" data-view="free"><strong>Estudo livre</strong><span>Filtros por tema, nível, tipo e idioma <kbd>F</kbd></span></button>
      <button class="btn tile" data-action="go" data-view="examSetup"><strong>Simulado</strong><span>${EXAM_SIZE} perguntas · ${EXAM_SECONDS} s cada</span></button>
      <button class="btn tile" data-action="start-errors" ${errs ? '' : 'disabled'}><strong>Meus erros</strong><span>${errs} ${errs === 1 ? 'card' : 'cards'}</span></button>
    </div>
    <p class="muted small">${S.cards.length} cards no seu baralho.</p>`);
}

function ensureFilters() {
  if (S.filters) return S.filters;
  S.filters = { decks: new Set(deckList()), subtopics: new Set(), levels: new Set(['1', '2', '3']), types: new Set(TYPES), langs: new Set(['pt', 'en']) };
  return S.filters;
}

function filteredCards() {
  const f = ensureFilters();
  return S.cards.filter((c) => f.decks.has(c.deck)
    && (f.subtopics.size === 0 || f.subtopics.has(`${c.deck}|${c.subtopic}`))
    && f.levels.has(String(c.level)) && f.types.has(c.card_type) && f.langs.has(c.lang));
}

function viewFree() {
  const f = ensureFilters();
  const decks = deckList();
  const subs = [];
  for (const d of decks) if (f.decks.has(d)) {
    for (const s of [...new Set(S.cards.filter((c) => c.deck === d).map((c) => c.subtopic))]) subs.push([d, s]);
  }
  const n = filteredCards().length;
  return page('home', `
    <h1>Estudo livre</h1>
    <section class="panel">
      <div class="group-title">Tema</div>
      <div class="chips">${decks.map((d) => chip('decks', d, d, f.decks.has(d))).join('')}</div>
      <div class="group-title">Subtema <span class="muted small">(nenhum marcado = todos)</span></div>
      <div class="chips">${subs.map(([d, s]) => chip('subtopics', `${d}|${s}`, decks.length > 1 ? `${s} · ${d}` : s, f.subtopics.has(`${d}|${s}`))).join('')}</div>
      <div class="group-title">Nível</div>
      <div class="chips">${['1', '2', '3'].map((l) => chip('levels', l, ['Básico', 'Intermediário', 'Avançado'][+l - 1], f.levels.has(l))).join('')}</div>
      <div class="group-title">Tipo</div>
      <div class="chips">${TYPES.map((t) => chip('types', t, TYPE_LABEL[t], f.types.has(t))).join('')}</div>
      <div class="group-title">Idioma</div>
      <div class="chips">${['pt', 'en'].map((l) => chip('langs', l, l === 'pt' ? 'Português' : 'Inglês', f.langs.has(l))).join('')}</div>
    </section>
    <button class="btn primary big" data-action="start-free" ${n ? '' : 'disabled'}>Começar · ${n} ${n === 1 ? 'card' : 'cards'} em ordem aleatória</button>`);
}

function viewExamSetup() {
  const decks = deckList();
  if (!S.examDecks) S.examDecks = new Set(decks.filter((d) => d !== 'Fit'));
  const pool = examPool();
  return page('home', `
    <h1>Simulado de entrevista</h1>
    <section class="panel">
      <p>${EXAM_SIZE} perguntas aleatórias, ${EXAM_SECONDS} segundos cada. Você precisa digitar a resposta antes de revelar; quando o tempo acaba, a resposta-modelo aparece. No final, você recebe uma nota por tema.</p>
      <div class="group-title">Temas</div>
      <div class="chips">${decks.map((d) => chip('examDecks', d, d, S.examDecks.has(d))).join('')}</div>
      <div class="group-title">Opções</div>
      <div class="chips">${chip('examFit', 'fit', 'Incluir perguntas de Fit', S.examIncludeFit)}</div>
    </section>
    <button class="btn primary big" data-action="start-exam" ${pool.length ? '' : 'disabled'}>Começar simulado</button>`);
}

function examPool() {
  return S.cards.filter((c) => S.examDecks.has(c.deck) && (S.examIncludeFit || c.card_type !== 'fit'));
}

function cardMeta(c) {
  return `<div class="meta"><span>${esc(c.deck)} › ${esc(c.subtopic)}</span>
    <span class="tag">Nível ${c.level}</span><span class="tag">${esc(TYPE_LABEL[c.card_type] || c.card_type)}</span><span class="tag">${LANG_LABEL[c.lang] || c.lang}</span></div>`;
}

function viewSession() {
  const s = S.session;
  const c = S.byId.get(s.queue[s.pos]);
  const p = S.progress.get(c.id) || newProgress(c.id);
  const exam = s.mode === 'exam';
  const canReveal = !exam || s.typed.trim() || s.timedOut;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const timer = exam ? `<span class="timer ${s.timeLeft <= 15 ? 'low' : ''}" id="timer">${fmtTimer(s.timeLeft)}</span>` : '';
  const answerArea = s.revealed
    ? `<div class="compare revealed">
        <div class="pane mine"><h3>Sua resposta</h3>${s.typed.trim() ? `<p class="typed">${esc(s.typed)}</p>` : '<p class="muted">(sem resposta digitada)</p>'}
          ${s.timedOut ? '<p class="muted small">Tempo esgotado.</p>' : ''}</div>
        <div class="pane model"><h3>Resposta-modelo</h3><div class="md">${renderMarkdown(c.answer)}</div></div>
      </div>
      ${isTouch ? '<p class="swipe-hint">Deslize ← Errei · Bom →</p>' : ''}`
    : `<label class="field"><span>${exam ? 'Sua resposta (obrigatória)' : 'Sua resposta (opcional)'}</span>
        <textarea id="answer" placeholder="Responda como numa entrevista…">${esc(s.typed)}</textarea></label>`;
  const actions = s.revealed
    ? `<div class="grades">${[0, 1, 2, 3].map((g) => `<button class="grade" data-action="grade" data-g="${g}">${GRADE_LABELS[g]}<small>${exam ? `<kbd>${g + 1}</kbd>` : `${previewLabel(p, g)} <kbd>${g + 1}</kbd>`}</small></button>`).join('')}</div>`
    : `<button class="btn primary big" id="reveal" data-action="reveal" ${canReveal ? '' : 'disabled'}>Revelar <kbd>Espaço</kbd></button>`;
  return `<div class="shell">${header()}<main class="session">
      <div class="session-top">
        <button class="btn link" data-action="quit-session">← Sair</button>
        <span class="counter">${esc(s.title)} · ${s.pos + 1}/${s.queue.length}</span>${timer}
      </div>
      <article class="card" id="card">${cardMeta(c)}<h2 class="q">${esc(c.question)}</h2>${answerArea}</article>
    </main>
    <div class="actions"><div class="inner">${actions}</div></div></div>`;
}

function fmtTimer(sec) {
  const m = Math.floor(Math.max(0, sec) / 60), r = Math.max(0, sec) % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function resultsByDeck(results) {
  const by = new Map();
  for (const r of results) {
    const d = S.byId.get(r.id)?.deck || '—';
    if (!by.has(d)) by.set(d, []);
    by.get(d).push(r.g);
  }
  return [...by.entries()].map(([deck, gs]) => ({
    deck, n: gs.length, acc: gs.filter((g) => g >= 2).length / gs.length,
    nota: (gs.reduce((a, b) => a + b, 0) / gs.length) / 3 * 10
  }));
}

function viewSummary() {
  const r = S.summary;
  const n = r.results.length;
  const acc = n ? r.results.filter((x) => x.g >= 2).length / n : 0;
  const wrong = [...new Set(r.results.filter((x) => x.g === 0).map((x) => x.id))];
  const rows = resultsByDeck(r.results).map((d) => `<tr><td>${esc(d.deck)}</td><td class="num">${d.n}</td><td class="num">${fmtPct(d.acc)}</td></tr>`).join('');
  return page('home', `
    <h1>Sessão concluída</h1>
    <div class="kpis"><div class="kpi"><b>${n}</b><span>respostas</span></div><div class="kpi"><b>${fmtPct(acc)}</b><span>acerto (Bom/Fácil)</span></div><div class="kpi"><b>${wrong.length}</b><span>errados</span></div></div>
    ${n ? `<section class="panel"><table class="stats"><thead><tr><th>Tema</th><th class="num">Cards</th><th class="num">Acerto</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}
    <div class="row">${wrong.length ? '<button class="btn" data-action="retry-wrong">Revisar os errados</button>' : ''}<button class="btn primary" data-action="go" data-view="home">Voltar ao início</button></div>`);
}

function viewExamResult() {
  const r = S.examResult;
  const decks = resultsByDeck(r.results);
  const overall = r.results.reduce((a, x) => a + x.g, 0) / r.results.length / 3 * 10;
  const list = r.results.map((x) => {
    const c = S.byId.get(x.id);
    return `<li><span>${esc(c ? c.question : '')}<br><span class="muted small">${esc(c?.deck || '')} · ${Math.round(x.ms / 1000)} s${x.timedOut ? ' · tempo esgotado' : ''}</span></span><span class="pill g${x.g}">${GRADE_LABELS[x.g]}</span></li>`;
  }).join('');
  return page('home', `
    <h1>Resultado do simulado</h1>
    <div class="kpis"><div class="kpi"><b>${overall.toFixed(1)}</b><span>nota geral (0–10)</span></div>
      <div class="kpi"><b>${fmtPct(r.results.filter((x) => x.g >= 2).length / r.results.length)}</b><span>acerto</span></div>
      <div class="kpi"><b>${Math.round(r.results.reduce((a, x) => a + x.ms, 0) / r.results.length / 1000)} s</b><span>tempo médio</span></div></div>
    <section class="panel"><h2>Nota por tema</h2>
      <table class="stats"><thead><tr><th>Tema</th><th class="num">Perguntas</th><th class="num">Nota</th></tr></thead><tbody>
      ${decks.map((d) => `<tr><td>${esc(d.deck)}<div class="bar"><i style="width:${Math.round(d.nota * 10)}%"></i></div></td><td class="num">${d.n}</td><td class="num">${d.nota.toFixed(1)}</td></tr>`).join('')}
      </tbody></table></section>
    <section class="panel"><h2>Perguntas</h2><ul class="list">${list}</ul></section>
    <div class="row"><button class="btn" data-action="go" data-view="examSetup">Novo simulado</button><button class="btn primary" data-action="go" data-view="home">Início</button></div>`);
}

function viewStats() {
  const now = new Date();
  const due = dueCards().length;
  const st = streak(S.reviews, now);
  const studied = S.progress.size;
  const today = S.reviews.filter((r) => parseTs(r.reviewed_at) >= startOfDay(now)).length;
  const rows = deckStats(S.cards, S.progress, S.reviews, deckList(), now);
  const weak = weakest(S.cards, S.reviews, now);
  const bar = (x) => `<div class="bar"><i style="width:${Math.round((x || 0) * 100)}%"></i></div>`;
  return page('stats', `
    <h1>Estatísticas</h1>
    <div class="kpis">
      <div class="kpi"><b>${due}</b><span>vencidos hoje</span></div>
      <div class="kpi"><b>${st}</b><span>dias seguidos</span></div>
      <div class="kpi"><b>${today}</b><span>revisões hoje</span></div>
      <div class="kpi"><b>${studied}/${S.cards.length}</b><span>cards já vistos</span></div>
    </div>
    <section class="panel"><h2>Por tema</h2>
      <table class="stats"><thead><tr><th>Tema</th><th class="num">Domínio</th><th class="num">Acerto 7d</th><th class="num">Acerto 30d</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.deck)}${bar(r.mastery)}</td><td class="num">${fmtPct(r.mastery)}</td><td class="num">${fmtPct(r.acc7)}<br><span class="muted small">${r.n7}</span></td><td class="num">${fmtPct(r.acc30)}<br><span class="muted small">${r.n30}</span></td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">Domínio = % de cards com intervalo de 21 dias ou mais. Acerto = respostas Bom ou Fácil.</p></section>
    <section class="panel"><h2>Tópicos mais fracos (30 dias)</h2>
      ${weak.length ? `<ul class="list">${weak.map((w) => `<li><span>${esc(w.name)}</span><span class="muted">${fmtPct(w.acc)} · ${w.n} resp.</span></li>`).join('')}</ul>` : '<p class="muted">Responda pelo menos 3 cards de um subtema para ele aparecer aqui.</p>'}
    </section>`);
}

function viewSettings() {
  const st = sync.getStatus();
  const theme = document.documentElement.dataset.theme;
  return page('settings', `
    <h1>Ajustes</h1>
    <section class="panel">
      <label class="field"><span>Cards novos por dia</span>
        <input type="number" id="newPerDay" min="0" max="100" step="1" value="${S.newPerDay}"></label>
      <div class="group-title">Tema</div>
      <div class="chips">${chip('theme', 'dark', 'Escuro', theme === 'dark')}${chip('theme', 'light', 'Claro', theme === 'light')}</div>
    </section>
    <section class="panel">
      <h2>Sincronização</h2>
      <p>${esc(syncLabel(st))}<br><span class="muted small">Última sincronização: ${fmtDateTime(st.lastSync)}</span></p>
      ${st.error ? `<div class="msg err">${esc(st.error)}</div>` : ''}
      <div class="row"><button class="btn" data-action="sync">Sincronizar agora</button>
      ${st.code === 'NO_SESSION' ? '<button class="btn primary" data-action="relogin">Entrar novamente</button>' : ''}</div>
    </section>
    ${S.updateReady ? '<section class="panel"><p>Há uma nova versão do app.</p><button class="btn primary" data-action="apply-update">Atualizar agora</button></section>' : ''}
    <section class="panel">
      <h2>Atalhos</h2>
      <p class="small muted">Computador: <kbd>Espaço</kbd> revelar · <kbd>1</kbd>–<kbd>4</kbd> notas · <kbd>F</kbd> filtros · <kbd>Esc</kbd> sair da sessão.<br>
      Celular: depois de revelar, deslize para a esquerda (Errei) ou para a direita (Bom).</p>
    </section>
    <section class="panel">
      <button class="btn danger" data-action="signout">Sair da conta</button>
      <p class="muted small">Versão ${APP_VERSION} · ${esc(deviceName())}</p>
    </section>`);
}

function render() {
  stopTimerIfNeeded();
  const views = { boot: viewBoot, login: viewLogin, home: viewHome, free: viewFree, examSetup: viewExamSetup, session: viewSession, summary: viewSummary, examResult: viewExamResult, stats: viewStats, settings: viewSettings };
  $app.innerHTML = (views[S.view] || viewHome)();
  if (S.view === 'session') afterSessionRender();
  if (S.view === 'login') $app.querySelector('input')?.focus();
}

function go(view) {
  S.view = view;
  render();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- study session

function startSession(mode, ids, title) {
  if (!ids.length) { toast('Nenhum card para estudar agora.'); return; }
  S.session = {
    mode, title, queue: ids.slice(), pos: 0, revealed: false, typed: '',
    cardStart: Date.now(), results: [], timeLeft: EXAM_SECONDS, timedOut: false, timer: null
  };
  go('session');
}

function startDaily() {
  const due = dueCards().map((c) => c.id);
  const fresh = newCardsForToday().map((c) => c.id);
  startSession('daily', [...due, ...fresh], 'Revisão do dia');
}

function afterSessionRender() {
  const s = S.session;
  const ta = document.getElementById('answer');
  if (ta) {
    ta.addEventListener('input', () => {
      s.typed = ta.value;
      const btn = document.getElementById('reveal');
      if (btn && s.mode === 'exam') btn.disabled = !(s.typed.trim() || s.timedOut);
    });
    if (!matchMedia('(pointer: coarse)').matches) ta.focus();
  }
  if (s.mode === 'exam' && !s.revealed) startTimer();
  if (s.revealed) bindSwipe(document.getElementById('card'));
}

function startTimer() {
  const s = S.session;
  clearInterval(s.timer);
  s.timer = setInterval(() => {
    s.timeLeft -= 1;
    const el = document.getElementById('timer');
    if (el) { el.textContent = fmtTimer(s.timeLeft); el.classList.toggle('low', s.timeLeft <= 15); }
    if (s.timeLeft <= 0) {
      clearInterval(s.timer);
      s.timedOut = true;
      const ta = document.getElementById('answer');
      if (ta) s.typed = ta.value;
      reveal(true);
    }
  }, 1000);
}

function stopTimerIfNeeded() {
  if (S.session?.timer && (S.view !== 'session' || S.session.revealed)) {
    clearInterval(S.session.timer);
    S.session.timer = null;
  }
}

function reveal(force = false) {
  const s = S.session;
  if (!s || s.revealed) return;
  const ta = document.getElementById('answer');
  if (ta) s.typed = ta.value;
  if (s.mode === 'exam' && !force && !s.typed.trim() && !s.timedOut) {
    toast('No simulado, digite sua resposta antes de revelar.');
    return;
  }
  s.revealed = true;
  s.revealMs = Date.now() - s.cardStart;
  render();
}

async function grade(g) {
  const s = S.session;
  if (!s || !s.revealed || s.grading) return;
  s.grading = true;
  try {
    const id = s.queue[s.pos];
    const now = new Date();
    const prev = S.progress.get(id) || newProgress(id);
    const next = { ...schedule(prev, g, now), dirty: 1 };
    S.progress.set(id, next);
    const ms = s.mode === 'exam' ? Math.min(EXAM_SECONDS * 1000, s.revealMs ?? Date.now() - s.cardStart) : Date.now() - s.cardStart;
    const review = {
      id: uuid(), card_id: id, grade: g, typed_answer: s.typed.trim() || null,
      time_ms: ms, device: deviceName(), reviewed_at: now.toISOString(), synced: 0
    };
    S.reviews.push(review);
    await db.put('progress', next);
    await db.put('reviews', review);
    s.results.push({ id, g, ms, timedOut: s.timedOut });
    if (g === 0 && s.mode !== 'exam') s.queue.splice(Math.min(s.pos + 4, s.queue.length), 0, id); // comes back this session
    sync.refreshPending();
    sync.scheduleSync();

    s.pos += 1;
    s.revealed = false; s.typed = ''; s.timedOut = false; s.timeLeft = EXAM_SECONDS; s.cardStart = Date.now(); s.revealMs = null;
    if (s.pos >= s.queue.length) finishSession();
    else render();
  } finally {
    s.grading = false;
  }
}

function finishSession() {
  const s = S.session;
  clearInterval(s.timer);
  S.session = null;
  if (s.mode === 'exam') { S.examResult = { results: s.results }; go('examResult'); }
  else { S.summary = { results: s.results, mode: s.mode }; go('summary'); }
}

function quitSession() {
  const s = S.session;
  if (!s) return go('home');
  // Answers are saved as they are graded, so leaving never loses work.
  clearInterval(s.timer);
  S.session = null;
  if (s.results.length && s.mode !== 'exam') { S.summary = { results: s.results, mode: s.mode }; go('summary'); }
  else go('home');
}

function bindSwipe(el) {
  if (!el) return;
  let x0 = 0, y0 = 0, dx = 0, tracking = false;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; tracking = true;
    el.classList.add('dragging');
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (Math.abs(dy) > Math.abs(dx) * 1.2) { dx = 0; el.style.transform = ''; return; }
    el.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    el.classList.toggle('swipe-left', dx < -40);
    el.classList.toggle('swipe-right', dx > 40);
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false;
    el.classList.remove('dragging', 'swipe-left', 'swipe-right');
    el.style.transform = '';
    if (dx > 90) grade(2);
    else if (dx < -90) grade(0);
  });
}

// ---------------------------------------------------------------- events

async function onSubmit(e) {
  const form = e.target.closest('form');
  if (!form) return;
  e.preventDefault();
  const L = S.login;
  if (form.dataset.form === 'email') {
    L.email = form.email.value.trim().toLowerCase();
    await sendLoginCode();
  } else if (form.dataset.form === 'code') {
    const code = form.code.value;
    L.busy = true; L.msg = ''; render();
    try {
      await auth.verifyCode(L.email, code);
      await finishLogin();
    } catch (err) {
      L.busy = false; L.msg = err.message; L.err = true; render();
    }
  }
}

async function sendLoginCode() {
  const L = S.login;
  L.busy = true; L.msg = ''; render();
  try {
    await auth.sendCode(L.email);
    L.step = 'code'; L.msg = 'E-mail enviado. Confira a caixa de entrada (e o spam).'; L.err = false;
  } catch (err) {
    L.msg = err.message; L.err = true;
  }
  L.busy = false; render();
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  switch (a) {
    case 'go': go(el.dataset.view); break;
    case 'sync': sync.syncNow(); break;
    case 'start-daily': startDaily(); break;
    case 'start-errors': startSession('errors', shuffle(errorCards().map((c) => c.id)), 'Meus erros'); break;
    case 'start-free': startSession('free', shuffle(filteredCards().map((c) => c.id)), 'Estudo livre'); break;
    case 'start-exam': startSession('exam', shuffle(examPool().map((c) => c.id)).slice(0, EXAM_SIZE), 'Simulado'); break;
    case 'retry-wrong': {
      const ids = [...new Set(S.summary.results.filter((x) => x.g === 0).map((x) => x.id))];
      startSession('errors', ids, 'Revisar errados');
      break;
    }
    case 'reveal': reveal(); break;
    case 'grade': grade(Number(el.dataset.g)); break;
    case 'quit-session': quitSession(); break;
    case 'chip': toggleChip(el.dataset.group, el.dataset.value); break;
    case 'login-resend': await sendLoginCode(); break;
    case 'login-change': S.login.step = 'email'; S.login.msg = ''; render(); break;
    case 'relogin': S.login = { step: 'email', email: (await db.getMeta('email', '')) || '', msg: '', err: false, busy: false }; go('login'); break;
    case 'apply-update': applyUpdate(); break;
    case 'signout': {
      const pending = sync.getStatus().pending;
      const warn = pending ? `\n\nAtenção: ${pending} revisões ainda não foram sincronizadas e serão perdidas.` : '';
      if (!confirm(`Sair da conta e apagar os dados deste aparelho?${warn}`)) return;
      await auth.signOut();
      S.cards = []; S.byId = new Map(); S.progress = new Map(); S.reviews = [];
      S.login = { step: 'email', email: '', msg: '', err: false, busy: false };
      go('login');
      break;
    }
  }
}

function toggleChip(group, value) {
  if (group === 'theme') { setTheme(value); render(); return; }
  if (group === 'examFit') { S.examIncludeFit = !S.examIncludeFit; render(); return; }
  if (group === 'examDecks') {
    S.examDecks.has(value) ? S.examDecks.delete(value) : S.examDecks.add(value);
    render(); return;
  }
  const f = ensureFilters();
  const set = f[group];
  set.has(value) ? set.delete(value) : set.add(value);
  if (group === 'decks') for (const k of [...f.subtopics]) if (!f.decks.has(k.split('|')[0])) f.subtopics.delete(k);
  render();
}

async function onChange(e) {
  if (e.target.id === 'newPerDay') {
    const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
    S.newPerDay = v;
    await db.setMeta('newPerDay', v);
    toast(`Novos por dia: ${v}`);
  }
}

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'textarea' || tag === 'input';
  if (S.view === 'session' && S.session) {
    const s = S.session;
    if (e.key === 'Escape') { e.preventDefault(); quitSession(); return; }
    if (!s.revealed) {
      if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === ' ' && !typing)) { e.preventDefault(); reveal(); }
      return;
    }
    if (!typing && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); grade(Number(e.key) - 1); }
    return;
  }
  if (!typing && (e.key === 'f' || e.key === 'F') && ['home', 'free', 'stats', 'summary'].includes(S.view) && S.cards.length) {
    e.preventDefault(); go('free');
  }
}

// ---------------------------------------------------------------- theme, SW, boot

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#f4f6fa' : '#0f1218');
  try { localStorage.setItem('ibfc-theme', t); } catch (_) { /* private mode */ }
}

function initTheme() {
  let t = 'dark';
  try { t = localStorage.getItem('ibfc-theme') || 'dark'; } catch (_) { /* ignore */ }
  setTheme(t);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Only reload when an existing worker is replaced (an update), never on the first install:
  // a reload then could interrupt a login that is arriving from an e-mail link.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    S.swReg = reg;
    const flag = () => {
      S.updateReady = true;
      toast('Nova versão disponível. <button class="btn link" data-action="apply-update">Atualizar</button>', 0);
    };
    if (reg.waiting && navigator.serviceWorker.controller) flag();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) flag(); });
    });
  }).catch((err) => console.warn('SW registration failed', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

function applyUpdate() {
  const w = S.swReg && S.swReg.waiting;
  if (w) w.postMessage({ type: 'SKIP_WAITING' }); else location.reload();
}

async function boot() {
  initTheme();
  registerSW();
  document.addEventListener('click', onClick);
  $toast.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);

  sync.onStatus((st) => {
    const el = document.getElementById('sync');
    if (el) { el.className = `sync ${st.state}`; el.textContent = syncLabel(st); }
  });
  sync.onData(async () => {
    await loadLocal();
    if (['home', 'stats', 'free', 'examSetup', 'settings'].includes(S.view)) render();
  });
  window.addEventListener('online', () => sync.syncNow());
  window.addEventListener('offline', () => sync.refreshPending());
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && navigator.onLine && (await auth.currentUserId())) sync.syncNow();
  });

  // Returning from a tapped e-mail link?
  const redirect = await auth.handleRedirect();
  if (redirect?.userId) {
    await finishLogin();
    return;
  }
  if (redirect?.error) {
    S.login = { ...S.login, msg: redirect.error, err: true };
  }

  const uid = await auth.currentUserId();
  if (!uid) { go('login'); return; }
  await loadLocal();
  go('home');
  await sync.refreshPending();
  if (navigator.onLine) sync.syncNow();
}

/** After a successful sign-in: download cards, then open the home screen. */
async function finishLogin() {
  S.bootMsg = 'Baixando seus cards…';
  go('boot');
  await sync.syncNow();
  await loadLocal();
  S.login = { step: 'email', email: '', msg: '', err: false, busy: false };
  go('home');
  const st = sync.getStatus();
  if (st.state === 'error') toast(esc(st.error), 6000);
}

boot().catch((err) => {
  console.error(err);
  $app.innerHTML = `<div class="center"><p>Erro ao iniciar o app.</p><p class="muted small">${esc(err.message || err)}</p></div>`;
});
