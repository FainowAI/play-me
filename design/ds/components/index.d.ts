// Play.Me components — window.PlayMe
type Camelot = `${1|2|3|4|5|6|7|8|9|10|11|12}${'A'|'B'}`;
type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
type SectionType = 'intro' | 'groove' | 'build' | 'drop' | 'break' | 'outro';
interface Section { type: SectionType; bars: number; vocal?: boolean }
interface TrackRef { title: string; bpm: number; camelot: Camelot }
export declare function Icon(p: { name: 'play'|'check'|'arrow'|'send'|'plus'|'alert'|'tool'|'list'|'wave'; size?: number; className?: string }): JSX.Element;
export declare function Button(p: { variant?: 'primary'|'signal'|'outline'|'ghost'; size?: 'md'|'sm'; icon?: string; label?: string; type?: 'button'|'submit'; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }): JSX.Element;
export declare function KeyBadge(p: { camelot: Camelot | null; size?: 'md'|'lg' }): JSX.Element;
export declare function EnergyMeter(p: { value: number; estimated?: boolean; showNumber?: boolean }): JSX.Element;
export declare function StatusTag(p: { tone?: Tone; children: React.ReactNode }): JSX.Element;
export declare function TrackRow(p: { index: number; title: string; artist: string; bpm: number | null; camelot: Camelot | null; energy?: number; estimated?: boolean; state?: 'default'|'selected'|'playing'|'pending' }): JSX.Element;
export declare function PhraseBar(p: { sections: Section[]; deck?: 'a'|'b'; label?: string; exitAt?: number; entryAt?: number }): JSX.Element;
export declare function TransitionCard(p: { index?: string; from: TrackRef; to: TrackRef; relation: { tone: Tone; label: string }; deltaBpm: number; deltaEnergy: number; type: string; lengthBars: 4|8|16|32; exitAt?: number; entryAt?: number; aSections?: Section[]; bSections?: Section[]; reason?: string }): JSX.Element;
export declare function SetArc(p: { points: { energy: number }[]; current?: number; caption?: string }): JSX.Element;
export declare function CamelotWheel(p: { active?: Camelot; compatible?: Camelot[]; size?: number }): JSX.Element;
export declare function ChatMessage(p: { role?: 'user'|'assistant'; children: React.ReactNode }): JSX.Element;
export declare function ToolCall(p: { name: string; activity?: Activity; detail?: string; status?: 'running'|'done'|'error'|'waiting' }): JSX.Element;
export declare function Composer(p: { id?: string; placeholder?: string; value?: string; context?: string; onSubmit?: () => void }): JSX.Element;
export declare function ApprovalGate(p: { playlistName: string; trackCount: number; duration?: string; onApprove?: () => void; onReview?: () => void }): JSX.Element;
type Activity = 'idle'|'reading'|'matching'|'listening'|'scoring'|'planning'|'composing'|'shipping'|'working';
/** Orb de pensamento (thinking-orbs). Mapeia a atividade do agente para um estado do orb. */
export declare function AgentOrb(p: { activity: Activity; size?: 64 | 32 | 20; paused?: boolean; label?: string }): JSX.Element;
/** Linha "pensando": orb 20px + verbo + detalhe em mono. */
export declare function ThinkingStatus(p: { activity: Activity; verb?: string; detail?: string; size?: 20 | 32 }): JSX.Element;
/** Nome da ferramenta do MCP → atividade do orb. */
export declare function activityForTool(name: string): Activity;
