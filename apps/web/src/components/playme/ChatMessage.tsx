import { useLayoutEffect, useRef } from "react";
import { cx } from "./cx.ts";
import type { ChatMessageProps } from "./types.ts";

// Escalonar só o que monta junto (releitura de uma conversa): cada mensagem da mesma leva recebe --i (0, 1, 2…) e o CSS atrasa 30 ms por índice
// até o 12º; a partir daí entra sem atraso. Uma mensagem nova, sozinha, é índice 0. `wave` conta a leva e zera assim que o commit acaba.
// ponytail: contador de módulo em vez de o pai passar o índice; se mais de um <ChatColumn> montar ao mesmo tempo, as levas se misturam (só o atraso muda).
let wave = 0;
const staged = new WeakSet<Element>(); // o StrictMode roda o efeito duas vezes no mesmo nó

export function ChatMessage({ role = "assistant", children }: ChatMessageProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || staged.has(el)) return;
    staged.add(el);
    if (wave === 0)
      queueMicrotask(() => {
        wave = 0;
      });
    if (wave < 12) el.style.setProperty("--i", String(wave));
    wave++;
  }, []);
  return (
    <div ref={ref} className={cx("pm-msg", `pm-msg--${role}`)}>
      {role === "assistant" ? <span className="pm-msg__who">Play.Me</span> : null}
      <div className="pm-msg__body">{children}</div>
    </div>
  );
}
