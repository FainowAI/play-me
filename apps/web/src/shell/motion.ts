/**
 * Reordenar em 400 ms (DESIGN.md §4): quando chega uma versão nova do set, as linhas do painel (view-transition-name)
 * deslizam. Sem a API do navegador, ou com prefers-reduced-motion, a atualização entra direto (com a aba oculta, é o navegador que pula a transição).
 */
export function withViewTransition(update: () => void): void {
  if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const transition = document.startViewTransition(update);
  // aba oculta: o navegador pula a transição (a atualização roda igual) e rejeita `ready` com InvalidStateError; sem isto vira erro no console
  transition.ready.catch(() => undefined);
  transition.finished.catch(() => undefined);
}
