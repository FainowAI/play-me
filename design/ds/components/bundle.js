/* @ds-bundle: {"format":4,"namespace":"PlayMe","components":[{"name":"Button"},{"name":"KeyBadge"},{"name":"EnergyMeter"},{"name":"StatusTag"},{"name":"TrackRow"},{"name":"PhraseBar"},{"name":"TransitionCard"},{"name":"SetArc"},{"name":"CamelotWheel"},{"name":"ChatMessage"},{"name":"AgentOrb"},{"name":"ThinkingStatus"},{"name":"ToolCall"},{"name":"Composer"},{"name":"ApprovalGate"}]} */
(function () {
  var React = window.React, h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  /* Icons: 24px grid, stroke 1.75, round caps (Lucide-compatible geometry). */
  var P = {
    play: 'M7 5l12 7-12 7z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    arrow: 'M4 12h15M13 6l6 6-6 6',
    send: 'M12 19V5M6 11l6-6 6 6',
    plus: 'M12 5v14M5 12h14',
    alert: 'M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    tool: 'M14.7 6.3a4 4 0 00-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 005.2-5.2l-2.4 2.4-2.5-.6-.6-2.5z',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    wave: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2'
  };
  function Icon(p) {
    var d = P[p.name] || P.play;
    return h('svg', { className: cx('pm-icon', p.className), width: p.size || 16, height: p.size || 16, viewBox: '0 0 24 24', fill: p.name === 'play' ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: d }));
  }

  function Button(p) {
    var v = p.variant || 'outline', s = p.size || 'md';
    return h('button', { type: p.type || 'button', className: cx('pm-btn', 'pm-btn--' + v, 'pm-btn--' + s, p.className), disabled: p.disabled, onClick: p.onClick, 'aria-label': p.label },
      p.icon ? h(Icon, { name: p.icon, size: s === 'sm' ? 14 : 16 }) : null,
      p.children ? h('span', null, p.children) : null);
  }

  function parseKey(k) { var m = /^(\d{1,2})([AB])$/i.exec(String(k || '').trim()); return m ? { n: +m[1], ab: m[2].toUpperCase() } : null; }
  function KeyBadge(p) {
    var k = parseKey(p.camelot);
    if (!k) return h('span', { className: 'pm-key pm-key--none', title: 'Tom sem dado' }, '—');
    return h('span', { className: cx('pm-key', p.size === 'lg' && 'pm-key--lg'), style: { background: 'var(--key-' + k.n + k.ab + ')' }, title: 'Camelot ' + k.n + k.ab + (k.ab === 'A' ? ' · menor' : ' · maior') }, k.n + k.ab);
  }

  function EnergyMeter(p) {
    var v = Math.max(0, Math.min(10, Math.round(p.value || 0))), segs = [];
    for (var i = 1; i <= 10; i++) segs.push(h('i', { key: i, className: 'pm-energy__seg', style: i <= v ? { background: 'var(--energy-' + i + ')' } : null }));
    return h('span', { className: cx('pm-energy', p.estimated && 'pm-energy--est'), role: 'meter', 'aria-valuemin': 1, 'aria-valuemax': 10, 'aria-valuenow': v, 'aria-label': 'Energia ' + v + ' de 10' },
      h('span', { className: 'pm-energy__track' }, segs),
      p.showNumber === false ? null : h('span', { className: 'pm-energy__num' }, 'E' + v + (p.estimated ? '*' : '')));
  }

  function StatusTag(p) {
    var tone = p.tone || 'neutral';
    var icon = { ok: 'check', info: 'arrow', warn: 'alert', danger: 'alert' }[tone];
    return h('span', { className: cx('pm-tag', 'pm-tag--' + tone) }, icon ? h(Icon, { name: icon, size: 12 }) : null, p.children);
  }

  function TrackRow(p) {
    var st = p.state || 'default';
    return h('div', { className: cx('pm-row', 'pm-row--' + st), role: 'row' },
      h('span', { className: 'pm-row__idx' }, st === 'playing' ? h(Icon, { name: 'play', size: 12 }) : p.index),
      h('span', { className: 'pm-row__main' },
        h('span', { className: 'pm-row__title' }, p.title),
        h('span', { className: 'pm-row__artist' }, p.artist)),
      h('span', { className: 'pm-row__bpm' }, p.bpm != null ? Number(p.bpm).toFixed(p.bpm % 1 ? 1 : 0) : '—'),
      h(KeyBadge, { camelot: p.camelot }),
      p.energy != null ? h(EnergyMeter, { value: p.energy, estimated: p.estimated }) : h('span', { className: 'pm-row__na' }, '—'),
      st === 'pending' ? h(StatusTag, { tone: 'warn' }, 'A validar') : null);
  }

  var SECT = { intro: 'Intro', groove: 'Groove', build: 'Build', drop: 'Drop', break: 'Break', outro: 'Outro' };
  function PhraseBar(p) {
    var secs = p.sections || [], total = secs.reduce(function (a, s) { return a + s.bars; }, 0) || 1, at = 0;
    var mark = function (bar, kind) {
      if (bar == null) return null;
      var pct = (bar - 1) / total * 100;
      return h('span', { key: kind, className: cx('pm-phrase__mark', 'pm-phrase__mark--' + kind, pct < 8 && 'pm-phrase__mark--edge-start', pct > 92 && 'pm-phrase__mark--edge-end'), style: { left: pct + '%' } }, h('b', null, (kind === 'out' ? 'sai c.' : 'entra c.') + bar));
    };
    return h('div', { className: 'pm-phrase' },
      p.label ? h('div', { className: 'pm-phrase__head' }, h('span', { className: cx('pm-deck', p.deck && 'pm-deck--' + p.deck) }, p.deck ? p.deck.toUpperCase() : ''), h('span', { className: 'pm-phrase__name' }, p.label), h('span', { className: 'pm-phrase__bars' }, total + ' compassos')) : null,
      h('div', { className: 'pm-phrase__track' },
        secs.map(function (s, i) {
          var start = at + 1; at += s.bars;
          return h('span', { key: i, className: cx('pm-phrase__seg', s.vocal && 'pm-phrase__seg--vocal'), style: { flexGrow: s.bars, background: 'var(--section-' + s.type + ')' }, title: SECT[s.type] + ' · c.' + start + '–' + at + (s.vocal ? ' · vocal' : '') }, s.bars >= 8 ? SECT[s.type] : '');
        }),
        mark(p.exitAt, 'out'), mark(p.entryAt, 'in')));
  }

  function num(n, unit) { var s = n > 0 ? '+' : n < 0 ? '−' : '±'; return s + Math.abs(n) + (unit || ''); }
  function TransitionCard(p) {
    var a = p.from || {}, b = p.to || {}, rel = p.relation || {};
    return h('article', { className: 'pm-trans' },
      h('header', { className: 'pm-trans__head' },
        h('span', { className: 'label pm-trans__eyebrow' }, 'Transição ' + (p.index || '')),
        h(StatusTag, { tone: rel.tone || 'ok' }, rel.label || 'Segura')),
      h('div', { className: 'pm-trans__pair' },
        h('div', { className: 'pm-trans__track' }, h('span', { className: 'pm-deck pm-deck--a' }, 'A'), h('div', null, h('div', { className: 'pm-trans__title' }, a.title), h('div', { className: 'pm-trans__meta' }, a.bpm + ' BPM')), h(KeyBadge, { camelot: a.camelot })),
        h(Icon, { name: 'arrow', size: 18, className: 'pm-trans__arrow' }),
        h('div', { className: 'pm-trans__track' }, h('span', { className: 'pm-deck pm-deck--b' }, 'B'), h('div', null, h('div', { className: 'pm-trans__title' }, b.title), h('div', { className: 'pm-trans__meta' }, b.bpm + ' BPM')), h(KeyBadge, { camelot: b.camelot }))),
      h('dl', { className: 'pm-trans__stats' },
        h('div', null, h('dt', null, 'ΔBPM'), h('dd', null, num(p.deltaBpm))),
        h('div', null, h('dt', null, 'ΔEnergia'), h('dd', null, num(p.deltaEnergy))),
        h('div', null, h('dt', null, 'Tipo'), h('dd', null, p.type)),
        h('div', null, h('dt', null, 'Duração'), h('dd', null, p.lengthBars + ' c.'))),
      p.aSections ? h(PhraseBar, { deck: 'a', label: a.title, sections: p.aSections, exitAt: p.exitAt }) : null,
      p.bSections ? h(PhraseBar, { deck: 'b', label: b.title, sections: p.bSections, entryAt: p.entryAt }) : null,
      p.reason ? h('p', { className: 'pm-trans__reason' }, p.reason) : null);
  }

  function SetArc(p) {
    var pts = p.points || [], W = 600, H = 120, pad = 16, n = pts.length;
    if (!n) return null;
    var x = function (i) { return pad + (n === 1 ? 0 : i * (W - 2 * pad) / (n - 1)); };
    var y = function (e) { return H - pad - (e - 1) / 9 * (H - 2 * pad); };
    var line = pts.map(function (q, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(q.energy).toFixed(1); }).join(' ');
    var area = line + ' L' + x(n - 1).toFixed(1) + ' ' + (H - pad) + ' L' + x(0).toFixed(1) + ' ' + (H - pad) + ' Z';
    return h('figure', { className: 'pm-arc' },
      h('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Curva de energia do set' },
        [3, 5, 7, 9].map(function (e) { return h('line', { key: e, className: 'pm-arc__grid', x1: pad, x2: W - pad, y1: y(e), y2: y(e) }); }),
        h('path', { className: 'pm-arc__area', d: area }),
        h('path', { className: 'pm-arc__line', d: line }),
        pts.map(function (q, i) { return h('circle', { key: i, cx: x(i), cy: y(q.energy), r: i === p.current ? 5 : 3.5, className: i === p.current ? 'pm-arc__dot pm-arc__dot--now' : 'pm-arc__dot', style: i === p.current ? null : { fill: 'var(--energy-' + q.energy + ')' } }); })),
      p.caption ? h('figcaption', { className: 'pm-arc__cap' }, p.caption) : null);
  }

  function CamelotWheel(p) {
    var S = 240, c = S / 2, act = parseKey(p.active), hl = (p.compatible || []).map(String);
    function arc(r0, r1, i) {
      var a0 = (i * 30 - 105) * Math.PI / 180, a1 = ((i + 1) * 30 - 105) * Math.PI / 180, g = 0.02;
      a0 += g; a1 -= g;
      var P = function (r, a) { return (c + r * Math.cos(a)).toFixed(2) + ' ' + (c + r * Math.sin(a)).toFixed(2); };
      return 'M' + P(r1, a0) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + P(r1, a1) + ' L' + P(r0, a1) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + P(r0, a0) + 'Z';
    }
    var segs = [];
    for (var i = 0; i < 12; i++) {
      [['B', 82, 116], ['A', 46, 80]].forEach(function (ring) {
        var id = (i + 1) + ring[0], on = act && act.n === i + 1 && act.ab === ring[0], near = hl.indexOf(id) >= 0;
        var mid = (i * 30 - 90) * Math.PI / 180, rr = (ring[1] + ring[2]) / 2;
        segs.push(h('g', { key: id, className: cx('pm-wheel__seg', on && 'is-active', near && 'is-near', act && !on && !near && 'is-dim') },
          h('path', { d: arc(ring[1], ring[2], i), style: { fill: 'var(--key-' + id + ')' } }),
          h('text', { x: c + rr * Math.cos(mid), y: c + rr * Math.sin(mid), textAnchor: 'middle', dominantBaseline: 'central' }, id)));
      });
    }
    return h('svg', { className: 'pm-wheel', viewBox: '0 0 ' + S + ' ' + S, width: p.size || S, height: p.size || S, role: 'img', 'aria-label': 'Roda Camelot' + (act ? ', tom ativo ' + p.active : '') }, segs,
      act ? h('text', { className: 'pm-wheel__center', x: c, y: c, textAnchor: 'middle', dominantBaseline: 'central' }, p.active) : null);
  }

  function ChatMessage(p) {
    var role = p.role || 'assistant';
    return h('div', { className: cx('pm-msg', 'pm-msg--' + role) },
      role === 'assistant' ? h('span', { className: 'pm-msg__who' }, 'Play.Me') : null,
      h('div', { className: 'pm-msg__body' }, p.children));
  }

  /* Thinking orbs (thinking-orbs, MIT). Monochrome ink, follows data-theme. */
  var ACT = {
    idle:      { state: 'breathing',  verb: 'Pronto' },
    reading:   { state: 'searching',  verb: 'Lendo a playlist' },
    matching:  { state: 'connecting', verb: 'Casando com seus arquivos' },
    listening: { state: 'listening',  verb: 'Analisando o áudio' },
    scoring:   { state: 'solving',    verb: 'Pontuando as passagens' },
    planning:  { state: 'weaving',    verb: 'Planejando a transição' },
    composing: { state: 'composing',  verb: 'Montando o set' },
    shipping:  { state: 'shaping',    verb: 'Criando a playlist' },
    working:   { state: 'working',    verb: 'Trabalhando' }
  };
  var TOOL_ACT = [
    [/^spotify_(get_playlist|search|list)/, 'reading'],
    [/^library_match/, 'matching'],
    [/^analysis_/, 'listening'],
    [/^(dj_score_transition|dj_evaluate_order)/, 'scoring'],
    [/^(transition_plan|transition_render)/, 'planning'],
    [/^(dj_build_set|set_build)/, 'composing'],
    [/^(spotify_create_playlist|export_)/, 'shipping']
  ];
  function activityForTool(name) {
    for (var i = 0; i < TOOL_ACT.length; i++) if (TOOL_ACT[i][0].test(name || '')) return TOOL_ACT[i][1];
    return 'working';
  }
  function AgentOrb(p) {
    var a = ACT[p.activity] || ACT.working, size = p.size || 20;
    var Lib = window.ThinkingOrbs && window.ThinkingOrbs.ThinkingOrb;
    if (!Lib) return h('span', { className: 'pm-orb-fallback', style: { width: size, height: size }, role: 'img', 'aria-label': a.verb });
    return h(Lib, { state: a.state, size: size, paused: p.paused, 'aria-label': p.label || a.verb, className: cx('pm-orb', p.className) });
  }
  function ThinkingStatus(p) {
    var a = ACT[p.activity] || ACT.working;
    return h('div', { className: 'pm-thinking', role: 'status', 'aria-live': 'polite' },
      h(AgentOrb, { activity: p.activity, size: p.size || 20 }),
      h('span', { className: 'pm-thinking__verb' }, p.verb || a.verb),
      p.detail ? h('span', { className: 'pm-thinking__detail' }, p.detail) : null);
  }

  function ToolCall(p) {
    var st = p.status || 'done';
    var lbl = { running: 'rodando', done: 'concluído', error: 'falhou', waiting: 'aguardando você' }[st];
    return h('div', { className: cx('pm-tool', 'pm-tool--' + st) },
      st === 'running'
        ? h('span', { className: 'pm-tool__icon pm-tool__icon--orb' }, h(AgentOrb, { activity: p.activity || activityForTool(p.name), size: 20 }))
        : h('span', { className: 'pm-tool__icon' }, h(Icon, { name: st === 'error' ? 'alert' : st === 'done' ? 'check' : 'tool', size: 14 })),
      h('code', { className: 'pm-tool__name' }, p.name),
      p.detail ? h('span', { className: 'pm-tool__detail' }, p.detail) : null,
      h('span', { className: 'pm-tool__status' }, lbl));
  }

  function Composer(p) {
    return h('form', { className: 'pm-composer', onSubmit: function (e) { e.preventDefault(); p.onSubmit && p.onSubmit(); } },
      h('label', { className: 'pm-sr', htmlFor: p.id || 'pm-composer' }, 'Mensagem'),
      h('textarea', { id: p.id || 'pm-composer', rows: 1, className: 'pm-composer__input', placeholder: p.placeholder || 'Peça um set, uma transição ou uma análise…', defaultValue: p.value }),
      h('div', { className: 'pm-composer__bar' },
        h('span', { className: 'pm-composer__ctx' }, h(Icon, { name: 'list', size: 14 }), p.context || 'Nenhuma playlist'),
        h(Button, { variant: 'primary', size: 'sm', icon: 'send', label: 'Enviar', type: 'submit' })));
  }

  function ApprovalGate(p) {
    return h('section', { className: 'pm-gate', 'aria-label': 'Aprovação' },
      h('div', { className: 'pm-gate__head' },
        h('span', { className: 'label' }, 'Aprovação necessária'),
        h('h3', { className: 'title-3' }, 'Criar ' + (p.playlistName || '[DJ MIX] playlist'))),
      h('p', { className: 'pm-gate__text' }, 'Nova playlist privada no Spotify com ' + (p.trackCount || 0) + ' faixas nesta ordem' + (p.duration ? ' (' + p.duration + ')' : '') + '. A playlist original não muda.'),
      h('div', { className: 'pm-gate__actions' },
        h(Button, { variant: 'signal', icon: 'check', onClick: p.onApprove }, 'Aprovar e criar'),
        h(Button, { variant: 'ghost', onClick: p.onReview }, 'Revisar ordem')));
  }

  window.PlayMe = Object.assign(window.PlayMe || {}, { Icon: Icon, Button: Button, KeyBadge: KeyBadge, EnergyMeter: EnergyMeter, StatusTag: StatusTag, TrackRow: TrackRow, PhraseBar: PhraseBar, TransitionCard: TransitionCard, SetArc: SetArc, CamelotWheel: CamelotWheel, ChatMessage: ChatMessage, ToolCall: ToolCall, Composer: Composer, ApprovalGate: ApprovalGate, AgentOrb: AgentOrb, ThinkingStatus: ThinkingStatus, activityForTool: activityForTool });
})();
