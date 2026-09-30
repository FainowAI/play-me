/**
 * Peças do painel do set e das camadas (contrato em ./types.ts). A shell importa só daqui:
 * SetPanel na coluna de 400 px (ou gaveta); TransitionWindow, TrackDrawer e SettingsWindow dentro do Overlay.
 */
export { SetPanel } from "./SetPanel.tsx";
export { SettingsWindow } from "./SettingsWindow.tsx";
export { TrackDrawer } from "./TrackDrawer.tsx";
export { TransitionWindow } from "./TransitionWindow.tsx";
export type * from "./types.ts";
