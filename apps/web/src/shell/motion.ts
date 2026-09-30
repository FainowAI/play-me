/**
 * Reordenar em 400 ms (DESIGN.md §4): quando chega uma versão nova do set, as linhas do painel (view-transition-name)
 * deslizam. Sem a API do navegador, ou com prefers-reduced-motion, a atualização entra direto.
 */
export function withViewTransition(update: () => void): void {
  if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  document.startViewTransition(update);
}
