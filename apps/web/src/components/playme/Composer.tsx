import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import type { ComposerProps } from "./types.ts";

export function Composer({ id = "pm-composer", placeholder = "Peça um set, uma transição ou uma análise…", value, onChange, onSubmit, context, disabled, autoFocus }: ComposerProps) {
  // ponytail: autoFocus só na montagem; ao reabilitar (fim do turno) o foco não volta sozinho. Se precisar, a shell foca por id ou remonta com key.
  return (
    <form
      className="pm-composer"
      onSubmit={(e) => {
        e.preventDefault();
        const text = value.trim();
        if (text) onSubmit(text);
      }}
    >
      <label className="pm-sr" htmlFor={id}>
        Mensagem
      </label>
      <textarea
        id={id}
        rows={1}
        className="pm-composer__input"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter envia, Shift+Enter quebra linha; isComposing = Enter que só confirma um acento/IME. Um único caminho de envio: o submit do form.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="pm-composer__bar">
        <span className="pm-composer__ctx">
          <Icon name="list" size={14} />
          {context || "Nenhuma playlist"}
        </span>
        <Button variant="primary" size="sm" icon="send" label="Enviar" type="submit" disabled={disabled} />
      </div>
    </form>
  );
}
