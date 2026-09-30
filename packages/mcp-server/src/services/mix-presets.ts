/**
 * Presets do Mix do app do Spotify confirmados publicamente: SÓ "Fade" e "Rise".
 * Outros nomes (ex.: os do canvas) só entram aqui depois de o usuário confirmar no app.
 */
export const MIX_PRESETS = {
  Fade: "descrição a confirmar no app",
  Rise: "descrição a confirmar no app",
} as const;

export type MixPreset = keyof typeof MIX_PRESETS;
