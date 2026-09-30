/**
 * Camada nativa: <dialog> aberto com showModal() (foco preso, resto inerte, Esc), scrim no ::backdrop e abertura de
 * 200 ms por @starting-style (shell.css). O conteúdo é o `children`; quem monta a camada decide quando ela existe
 * (ponytail: desmonta ao fechar, então não há animação de saída; o contrato só pede abrir em 200 ms).
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export interface OverlayProps {
  open: boolean;
  kind: "drawer" | "window";
  side?: "left" | "right"; // só gaveta: a borda de onde ela desliza
  width: number; // px
  padding?: string; // padding do miolo, como no .dc.html de cada camada
  gap?: number; // px entre os filhos do miolo
  label: string;
  onClose: () => void;
  children: ReactNode;
}

export function Overlay({ open, kind, side = "right", width, padding, gap, label, onClose, children }: OverlayProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);

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

  return (
    <dialog
      ref={ref}
      className="overlay"
      data-kind={kind}
      data-side={kind === "drawer" ? side : undefined}
      aria-label={label}
      style={{ "--overlay-width": `${width}px` } as CSSProperties}
      // Esc: o estado do React manda (sem isso o <dialog> fecharia sozinho e o estado ficaria aberto)
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // clique no scrim fecha; exige o botão descer no scrim também, senão arrastar um slider e soltar fora fecharia a janela
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      {/* o <dialog> fica sem padding: um clique no padding teria o próprio <dialog> como alvo e fecharia a camada */}
      <div className="overlay__body" style={{ "--overlay-pad": padding, "--overlay-gap": gap === undefined ? undefined : `${gap}px` } as CSSProperties}>
        {children}
      </div>
    </dialog>
  );
}
