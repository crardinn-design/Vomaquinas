# Vô Máquinas — Correção do botão Enviar (Apps Script Web App)

Este repositório contém uma versão **corrigida e robusta** dos trechos críticos do
`index.html` que estavam impedindo o clique/Enter de disparar o envio no chat.

## ✅ Causa raiz encontrada

No seu `index.html`, a função `wireInputHandlers_()` foi **definida duas vezes**.
No final do arquivo existe este trecho:

```js
// override send (dynamic)
function wireInputHandlers_(){ /* replaced in setInputText/setInputTextarea */ }
```

Isso **sobrescreve** a versão real da função que registrava os listeners,
fazendo com que o botão “Enviar” e o Enter **não tivessem nenhum handler**.

## ✅ Correção direta (mantendo sua estrutura atual)

**Remova** o bloco acima e mantenha apenas a versão abaixo:

```js
function wireInputHandlers_(){
  const _input = document.getElementById("input");
  const _btn = document.getElementById("btnSend");

  _btn.addEventListener("click", () => {
    const t = _input.value;
    _input.value = "";
    handleUserText(t);
  });

  _input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // IME safe
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      _btn.click();
    }
  });
}
```

## ✅ Versão robusta (delegation + anti-duplo clique + feedback)

Se quiser uma versão ainda mais resiliente, use **delegação** para não perder
os listeners quando o DOM é recriado:

```js
let sending = false;

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#btnSend");
  if (!btn) return;

  if (sending) return;

  const input = document.getElementById("input");
  if (!input) return;

  const t = input.value.trim();
  if (!t) return;

  sending = true;
  btn.textContent = "Enviando...";
  btn.disabled = true;

  handleUserText(t);

  // libera após o ciclo (ajuste conforme seu fluxo)
  setTimeout(() => {
    sending = false;
    btn.textContent = "Enviar";
    btn.disabled = false;
  }, 300);
});

document.addEventListener("keydown", (e) => {
  const input = document.getElementById("input");
  if (!input || e.target !== input) return;

  if (e.isComposing) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("btnSend")?.click();
  }
});
```

## ✅ Checklist rápido de debug (console)

Cole esses logs em pontos-chave:

```js
console.log("[wireInputHandlers] input:", document.getElementById("input"));
console.log("[wireInputHandlers] btnSend:", document.getElementById("btnSend"));

// dentro do handler
console.log("[btnSend click] fired");

// no enter
console.log("[keydown]", e.key, "shift?", e.shiftKey, "isComposing?", e.isComposing);

// antes do google.script.run
console.log("[script.run] sending payload", payload);
```

## ✅ Resumo

- O botão não disparava porque o handler **não era registrado**.
- A causa foi a **sobrescrita** da função `wireInputHandlers_`.
- A correção é **remover o override** ou migrar para **event delegation**.
