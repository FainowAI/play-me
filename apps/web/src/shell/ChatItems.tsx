/**
 * Itens do chat (src/state.ts) como mensagens: o usuário à direita; tudo que o Play.Me faz numa resposta
 * (pensamento, ferramentas, texto, set, aprovação, erro) fica sob um rótulo "Play.Me" só, como no canvas.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { Activity } from "../activity.ts";
import { ApprovalGate, Button, ChatMessage, Icon, StatusTag, ThinkingStatus, ToolCall, TransitionCard } from "../components/playme/index.ts";
import { transitionCard, weakestPosition, splitProblems } from "../setview.ts";
import { answersLine, pendingApproval, pendingQuestions, type ChatItem } from "../state.ts";
import { renderMarkdown } from "./markdown.tsx";
import { approvalTitles, coverage, count, outOfSetLine, sentMeta, transitionsLabel } from "./text.ts";
import type { App } from "./useApp.ts";

type Item = Exclude<ChatItem, { kind: "user" }>;
type ToolItem = Extract<ChatItem, { kind: "tool" }>;
type SetItem = Extract<ChatItem, { kind: "set" }>;
type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;
type QuestionsItem = Extract<ChatItem, { kind: "questions" }>;
type ThinkingItem = Extract<ChatItem, { kind: "thinking" }>;
type Group = { key: string; role: "user"; text: string } | { key: string; role: "assistant"; items: Item[] };

/** Itens seguidos que não são do usuário formam uma resposta só. A chave da resposta é a da mensagem que a precede. */
function group(items: ChatItem[]): Group[] {
  const out: Group[] = [];
  let after = "start";
  for (const it of items) {
    if (it.kind === "user") {
      out.push({ key: it.id, role: "user", text: it.text });
      after = it.id;
      continue;
    }
    const last = out[out.length - 1];
    if (last?.role === "assistant") last.items.push(it);
    else out.push({ key: `a-${after}`, role: "assistant", items: [it] });
  }
  return out;
}

/**
 * Um bloco de resumo por versão nova do set em rascunho; o card "Criada no Spotify" só no último marcador `enviado`.
 * O servidor também emite `set` ao pedir aprovação (versão nova, aguardando_aprovacao) e ao rejeitar (mesma versão,
 * rascunho): nesses o gate e a linha de status já dizem tudo, então não repetem o card.
 */
function setMarks(items: ChatItem[]): { summary: Set<string>; lastSent: string | null } {
  const summary = new Set<string>();
  let top = 0;
  let lastSent: string | null = null;
  for (const it of items) {
    if (it.kind !== "set") continue;
    if (it.version > top) {
      if (it.status === "rascunho") summary.add(it.id);
      top = it.version;
    }
    if (it.status === "enviado") lastSent = it.id;
  }
  return { summary, lastSent };
}

export function ChatItems({ app }: { app: App }) {
  const { state } = app;
  const [deciding, setDeciding] = useState<string | null>(null); // approval com clique enviado, esperando a resposta
  const marks = setMarks(state.items);

  const groups = group(state.items);
  const reply = groups[groups.length - 1];
  const replying = reply?.role === "assistant" ? reply : null;
  // ThinkingStatus abre a resposta e fica até o fim do turno, junto do pensamento e do texto (contract.md, Sprint 5); com o gate ou as perguntas pendentes o turno espera o usuário
  const working = state.busy && pendingApproval(state) === null && pendingQuestions(state) === null;
  if (working && !replying) groups.push({ key: `a-${[...state.items].reverse().find((i) => i.kind === "user")?.id ?? "start"}`, role: "assistant", items: [] });
  const running = [...state.items].reverse().find((i): i is ToolItem => i.kind === "tool" && i.status === "running");

  const blocks = (items: Item[]): ReactNode[] => {
    const out: ReactNode[] = [];
    const last: ReactNode[] = []; // o resumo do set fecha a resposta, depois do texto do agente (SetProposto.dc.html)
    let tools: ToolItem[] = [];
    const flush = () => {
      if (tools.length > 0)
        out.push(
          <div key={`tools-${tools[0]?.id}`} className="tools">
            {tools.map((t) => (
              <ToolCall key={t.id} name={t.tool} detail={t.detail} status={t.status} activity={t.activity} />
            ))}
          </div>,
        );
      tools = [];
    };
    for (const [i, it] of items.entries()) {
      if (it.kind === "tool") {
        tools.push(it);
        const summary = it.tool === "metadata_coverage" ? it.summary : undefined;
        if (summary) {
          flush();
          out.push(<CoverageCard key={`cov-${it.id}`} summary={summary} />);
        }
        continue;
      }
      flush();
      if (it.kind === "text" || it.kind === "draft") {
        // chave pela posição: o texto final chega com id novo (state.ts); com a mesma chave ele herda o DOM do rascunho e nada remonta no fim do streaming
        out.push(<Fragment key={`md-${i}`}>{renderMarkdown(it.text, it.kind === "draft")}</Fragment>);
      } else if (it.kind === "thinking") out.push(<Think key={it.id} item={it} />);
      else if (it.kind === "set") {
        const summary = marks.summary.has(it.id);
        (summary ? last : out).push(<SetBlock key={it.id} app={app} item={it} summary={summary} sent={marks.lastSent === it.id} />);
      } else if (it.kind === "approval") out.push(<ApprovalBlock key={it.id} app={app} item={it} deciding={deciding} setDeciding={setDeciding} />);
      else if (it.kind === "questions") out.push(<QuestionsBlock key={it.id} app={app} item={it} />);
      else if (it.kind === "error") out.push(<ErrorLine key={it.id} text={it.text} />);
    }
    flush();
    return [...out, ...last];
  };

  return (
    <>
      {groups.map((g, i) =>
        g.role === "user" ? (
          <ChatMessage key={g.key} role="user">
            <span className="md-text user-text">{g.text}</span>
          </ChatMessage>
        ) : (
          <ChatMessage key={g.key} role="assistant">
            {i === groups.length - 1 && <Status on={working} activity={state.activity} detail={running?.detail || undefined} />}
            {blocks(g.items)}
          </ChatMessage>
        ),
      )}
    </>
  );
}

/**
 * ThinkingStatus do topo da resposta. Ao fim do turno fica montado por 200 ms, congelado no último estado (o verbo não vira "Pronto"),
 * desvanecendo e recolhendo (.pm-leaving, motion.css), e só então sai. O invólucro é sempre o mesmo nó: o orb não remonta na saída.
 */
function Status({ on, activity, detail }: { on: boolean; activity: Activity; detail: string | undefined }) {
  const [last, setLast] = useState({ activity, detail }); // último estado com o turno andando
  const [wasOn, setWasOn] = useState(on);
  const [leaving, setLeaving] = useState(false);
  // estado derivado durante o render (padrão do React): sem um quadro intermediário em que o status já sumiu
  if (on && (last.activity !== activity || last.detail !== detail)) setLast({ activity, detail });
  if (on !== wasOn) {
    setWasOn(on);
    setLeaving(wasOn);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), 200);
    return () => clearTimeout(t);
  }, [leaving]);
  if (!on && !leaving) return null;
  const shown = on ? { activity, detail } : last;
  return (
    <div className={on ? undefined : "pm-leaving"}>
      <ThinkingStatus activity={shown.activity} detail={shown.detail} size={32} />
    </div>
  );
}

/** Raciocínio do agente: aberto enquanto chega, fechado depois; o bloco final que o DJ abrir continua aberto. O cursor é CSS (`data-live`). */
function Think({ item }: { item: ThinkingItem }) {
  const [opened, setOpened] = useState(false); // o DJ abriu o bloco final
  if (!item.text.trim()) return null; // pensamento vazio (a API pode omitir o texto): sem bloco
  return (
    <details
      className="think"
      data-live={item.live || undefined}
      open={item.live || opened}
      // o `toggle` também dispara quando o React muda `open` (ao vivo → final): só conta o clique do DJ num bloco final
      onToggle={(e) => {
        if (!item.live) setOpened(e.currentTarget.open);
      }}
    >
      <summary>Pensamento</summary>
      <pre>{item.text}</pre>
    </details>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="err">
      <StatusTag tone="danger">Erro</StatusTag>
      <span className="md-text">{text}</span>
    </div>
  );
}

/** Gate de aprovação: só o clique chama a API; o turno no servidor espera por ele. */
function ApprovalBlock({ app, item, deciding, setDeciding }: { app: App; item: ApprovalItem; deciding: string | null; setDeciding: (id: string | null) => void }) {
  if (item.status === "rejected") return <p className="md-text md-p note">Envio não aprovado; o set voltou para rascunho.</p>;
  if (item.status === "expired") return <p className="md-text md-p note">Aprovação expirada; peça o envio de novo.</p>;
  if (item.status !== "pending") return null; // aprovada: a ToolCall já mostra o andamento
  const order = app.state.set?.versions.flatMap((v) => v.snapshot?.order ?? []) ?? []; // rótulos das versões já lidas; o gate pode montar antes do set chegar (aí sem lista)
  const decide = (act: (approvalId: string) => Promise<void>) => {
    setDeciding(item.id); // desabilita o gate até a resposta; falha de rede devolve o clique (o decide nunca rejeita)
    void act(item.id).finally(() => setDeciding(null));
  };
  return (
    <ApprovalGate
      playlistName={item.playlist_name}
      trackCount={item.track_count}
      tracks={approvalTitles(item.track_ids, order)}
      disabled={deciding === item.id}
      onApprove={() => decide(app.approve)}
      onReview={() => decide(app.reject)}
    />
  );
}

/** Perguntas do agente (ask_dj): pendente chama a janela; respondida e pulada viram uma linha do que ficou decidido. */
function QuestionsBlock({ app, item }: { app: App; item: QuestionsItem }) {
  if (item.status === "expired") return <p className="md-text md-p note">Perguntas expiradas; faça o pedido de novo.</p>;
  if (item.status === "skipped") return <p className="md-text md-p note">Perguntas puladas: vale a playlist inteira e a curva clássica.</p>;
  if (item.status === "answered") return <p className="md-text md-p note">{`Perguntas: ${answersLine(item)}`}</p>;
  return (
    <>
      <p className="md-text md-p note">Responda às perguntas na janela.</p>
      <div className="actions">
        <Button variant="ghost" size="sm" onClick={app.openQuestions}>
          Abrir perguntas
        </Button>
      </div>
    </>
  );
}

/** Depois do item `set`: a passagem mais arriscada em card, o que ficou de fora e os atalhos (SetProposto.dc.html). */
function SetBlock({ app, item, summary, sent }: { app: App; item: SetItem; summary: boolean; sent: boolean }) {
  const { state } = app;
  const set = state.set;
  if (!set || set.set.id !== item.set_id) return null; // o set ainda não chegou (ou é de outra conversa)
  if (item.status === "enviado") return sent ? <SentBlock app={app} /> : null;
  const version = set.versions.find((v) => v.version === item.version);
  if (!summary || !version?.snapshot) return null;
  const position = weakestPosition(version);
  const card = position === null ? null : transitionCard(version, position);
  const transitions = version.plans.length;
  const problems = splitProblems(version);
  const closed = set.set.status === "enviado"; // depois de enviado, os atalhos que viram mensagem perdem o sentido
  return (
    <>
      {card && position !== null && <TransitionCard {...card} onClick={() => app.openTransition(position, version.version)} />}
      {problems.out.length > 0 && <p className="md-text md-p note">{outOfSetLine(problems.out)}</p>}
      {problems.out.length === 0 && problems.warned.length > 0 && (
        <p className="md-text md-p note">{`${problems.warned.length} faixa(s) entraram com aviso (${problems.warned[0]?.reasons[0] ?? "ver painel"}).`}</p>
      )}
      {(transitions > 0 || !closed) && (
        <div className="actions">
          {transitions > 0 && (
            <Button variant="outline" size="sm" onClick={() => app.openPanel("transicoes", version.version)}>
              {transitionsLabel(transitions)}
            </Button>
          )}
          {!closed && (
            <>
              <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void app.send("Mais energia no meio.")}>
                Mais energia no meio
              </Button>
              <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void app.send("Tá bom assim. Pode mandar pro Spotify.")}>
                Mandar pro Spotify
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}

type Copy = "idle" | "ok" | "fail";

/** Enviado.dc.html: "Criada no Spotify" com o link, o guia do Mix para copiar e o pedido de um novo set. */
function SentBlock({ app }: { app: App }) {
  const [copy, setCopy] = useState<Copy>("idle");
  useEffect(() => {
    if (copy === "idle") return;
    const t = setTimeout(() => setCopy("idle"), 2000);
    return () => clearTimeout(t);
  }, [copy]);
  const set = app.state.set;
  const latest = set?.versions[set.versions.length - 1];
  if (!set || set.set.status !== "enviado" || !latest) return null;
  const raw = set.set.spotify_url;
  const url = raw && raw.startsWith("https://open.spotify.com/") ? raw : null; // só abre o Spotify
  // o nome da playlist criada vem do pedido de aprovação; o set guarda "<playlist> · <curva>"
  const created = app.state.items.filter((i) => i.kind === "approval" && i.status === "approved" && i.set_id === set.set.id).at(-1);
  const name = created?.kind === "approval" ? created.playlist_name : set.set.name;
  const copyGuide = async () => {
    try {
      await navigator.clipboard.writeText(latest.guide.map((g) => g.text).join("\n"));
      setCopy("ok");
    } catch {
      setCopy("fail"); // sem permissão ou contexto inseguro
    }
  };
  return (
    <>
      <section className="sent" aria-label="Playlist criada">
        <div className="sent__icon">
          <Icon name="list" size={24} />
        </div>
        <div className="sent__body">
          <span className="label sent__label">Criada no Spotify</span>
          <span className="title-3">{name}</span>
          <span className="sent__meta">{sentMeta(name, latest.order.length)}</span>
        </div>
        <Button variant="primary" size="sm" disabled={!url} title={url ? undefined : "Sem link da playlist"} onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}>
          Abrir no Spotify
        </Button>
      </section>
      <p className="md-text md-p">O guia do Mix está no painel, uma passagem por vez. Aplique no app do Spotify e dê uma nota a cada transição depois de ouvir.</p>
      <div className="actions">
        <Button variant="outline" size="sm" disabled={latest.guide.length === 0} onClick={() => void copyGuide()}>
          {copy === "ok" ? "Copiado" : copy === "fail" ? "Não foi possível copiar" : "Copiar guia do Mix"}
        </Button>
        <Button variant="outline" size="sm" disabled={app.state.busy} onClick={() => void app.send("Quero um novo set a partir deste, com ajustes. O que você sugere mudar?")}>
          Novo set a partir deste
        </Button>
      </div>
    </>
  );
}

const COVERAGE: [label: string, key: string][] = [
  ["Mixar", "mixar"],
  ["Web conferido", "web"],
  ["A validar", "a_validar"],
  ["Pendentes", "pendente"],
];

/** Analisando.dc.html: quatro números em mono, barra de progresso real e as legendas (contract.md, tela 2). */
function CoverageCard({ summary }: { summary: NonNullable<ToolItem["summary"]> }) {
  const cov = coverage(summary);
  return (
    <section className="cov" aria-label="Cobertura de metadados">
      <div className="cov__nums">
        {COVERAGE.map(([label, key]) => (
          <div key={key} className="cov__num">
            <span className="label">{label}</span>
            <span className="cov__val">{count(summary[key])}</span>
          </div>
        ))}
      </div>
      {cov && (
        <div
          className="cov__bar"
          role="progressbar"
          aria-label="Faixas com dado"
          aria-valuemin={0}
          aria-valuemax={cov.total}
          aria-valuenow={cov.done}
          aria-valuetext={`${cov.done} de ${cov.total} faixas com dado`}
        >
          <div className="cov__fill" style={{ width: `${cov.pct}%` }} />
        </div>
      )}
      <div className="cov__legend">
        <p>
          <StatusTag tone="warn">A validar</StatusTag>
          <span>Tom da web (sempre) ou BPM divergente.</span>
        </p>
        <p>
          <StatusTag tone="danger">Pendente</StatusTag>
          <span>Sem BPM ou tom em nenhuma fonte.</span>
        </p>
      </div>
      <p className="cov__foot">Mixar nunca é sobrescrito. BPM da ReccoBeats é conferido; o tom da web fica a validar. Nenhum áudio é baixado.</p>
    </section>
  );
}
