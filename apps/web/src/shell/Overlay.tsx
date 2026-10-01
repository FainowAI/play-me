/**
 * Camada nativa: <dialog> aberto com showModal() (foco preso, resto inerte, Esc), scrim no ::backdrop e abertura de 200 ms por
 * @starting-style (shell.css). O conteúdo é o `children`; quem monta a camada decide quando ela existe.
 * Saída: Esc e clique no scrim ligam `data-closing` (shell.css anima de volta: gaveta desliza, janela some em fade + scale, scrim some),
 * o <dialog> segue montado até o transitionend (teto de 250 ms) e só então o `onClose` do pai desmonta a camada.
 * ponytail: o botão "Fechar"/"Cancelar" de dentro das peças chama o onClose do pai direto, então desmonta sem saída; animar esses
 * também pede ao pai manter a camada montada e trocar `open`.
 */
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";

const EXIT_MS = 250; // teto da saída: se o transitionend não vier (aba oculta, sem transição), fecha assim mesmo

export interface OverlayProps {
  open: boolean;
  kind: "drawer" | "window";
  side?: "left" | "right"; // só gaveta: a borda de onde ela desliza
  width: number; // px
  padding?: string; // padding do miolo, como no .dc.html de cada camada
  gap?: number; // px entre os filhos do miolo
  label: string;
  onClose: () => void;
  /** Quem quiser fechar com a mesma saída animada dos botões internos recebe aqui a função (o pai a chama no "Fechar"/"Cancelar"). */
  closeRef?: MutableRefObject<(() => void) | null>;
  children: ReactNode;
}

export function Overlay({ open, kind, side = "right", width, padding, gap, label, onClose, closeRef, children }: OverlayProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const [closing, setClosing] = useState(false);

  // botões internos ("Fechar", "Cancelar", ações que fecham) passam pela mesma saída de Esc e scrim
  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = () => setClosing(true);
    return () => {
      closeRef.current = null;
    };
  }, [closeRef]);

  // nunca `open` como atributo: abriria sem ser modal e o showModal() lançaria InvalidStateError
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      // desmontada, a camada já saiu do DOM e o navegador não devolve o foco sozinho: volta para quem a abriu
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  const finish = useEffectEvent(() => {
    onClose();
    setClosing(false); // se o pai não desmontou, a camada volta ao estado aberto em vez de ficar invisível e modal
  });

  // saída em andamento: espera o fim da transição do próprio <dialog> (não a do scrim nem a dos filhos) ou o teto de 250 ms
  useEffect(() => {
    const dialog = ref.current;
    if (!closing || !dialog) return;
    const end = (e: TransitionEvent) => {
      if (e.target === dialog && !e.pseudoElement && e.propertyName === "transform") finish();
    };
    dialog.addEventListener("transitionend", end);
    const timer = setTimeout(finish, EXIT_MS);
    return () => {
      dialog.removeEventListener("transitionend", end);
      clearTimeout(timer);
    };
  }, [closing]);

  return (
    <dialog
      ref={ref}
      className="overlay"
      data-kind={kind}
      data-side={kind === "drawer" ? side : undefined}
      data-closing={closing || undefined}
      aria-label={label}
      style={{ "--overlay-width": `${width}px` } as CSSProperties}
      // Esc: o estado do React manda (sem isso o <dialog> fecharia sozinho e o estado ficaria aberto); passa pela saída animada
      onCancel={(e) => {
        e.preventDefault();
        setClosing(true);
      }}
      // clique no scrim fecha; exige o botão descer no scrim também, senão arrastar um slider e soltar fora fecharia a janela
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) setClosing(true);
      }}
    >
      {/* o <dialog> fica sem padding: um clique no padding teria o próprio <dialog> como alvo e fecharia a camada */}
      <div className="overlay__body" style={{ "--overlay-pad": padding, "--overlay-gap": gap === undefined ? undefined : `${gap}px` } as CSSProperties}>
        {children}
      </div>
    </dialog>
  );
}
