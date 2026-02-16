# Vomaquinas

## Correção para erro no envio do cadastro (`submitCadastro`)

Se o front retorna algo como:

> ❌ Erro ao salvar: erro no servidor : Exception: Infelizmente ocorreu um erro no servidor...

normalmente o problema é um destes pontos no Apps Script:

1. **Payload muito grande** (principalmente `files` em base64).
2. **Campo obrigatório ausente** no servidor.
3. **Falha na gravação** (planilha, Drive, permissão, cota).
4. **Erro estourado sem contexto** (servidor lança `Exception` genérica).

---

## Ajustes recomendados no `index.html`

### 1) Validar tamanho total dos anexos antes de enviar

Adicione estas funções no `<script>`:

```js
function calcBase64SizeBytes(dataUrl){
  const base64 = String(dataUrl || "").split(",")[1] || "";
  const len = base64.length;
  const padding = (base64.endsWith("==") ? 2 : (base64.endsWith("=") ? 1 : 0));
  return Math.floor((len * 3) / 4) - padding;
}

function getFilesTotalBytes(filesObj){
  return Object.values(filesObj || {}).reduce((acc, f) => {
    if (!f || !f.data) return acc;
    return acc + calcBase64SizeBytes(f.data);
  }, 0);
}
```

E no `finish()` antes do `google.script.run.submitCadastro(payload)`:

```js
const totalBytes = getFilesTotalBytes(d.files || {});
const totalMb = totalBytes / 1024 / 1024;
if (totalMb > 18) {
  showLoading(false);
  addMsg(
    "bot",
    `❌ Os arquivos estão muito pesados para envio (${totalMb.toFixed(1)}MB).\n` +
    `Tente reenviar com fotos mais leves (ideal: até 3MB por foto).`
  );
  offerSaveCadastroLocal();
  return;
}
```

> Observação: Apps Script costuma falhar com payloads grandes em JSON/base64.

### 2) Melhorar tratamento de erro para mostrar mensagem útil

Adicione:

```js
function normalizeServerError(err){
  const raw = String((err && (err.message || err.stack || err)) || "").trim();
  if (!raw) return "Erro desconhecido no servidor.";
  return raw.replace(/\s+/g, " ");
}
```

Troque seu `withFailureHandler` atual por:

```js
.withFailureHandler((err)=>{
  showLoading(false);
  const message = normalizeServerError(err);
  addMsg(
    "bot",
    "❌ Falha ao enviar para o servidor.\n" +
    `Detalhe: ${esc(message)}\n\n` +
    "Dica: se anexou fotos grandes, tente imagens menores."
  );
  offerSaveCadastroLocal();
})
```

### 3) Incluir timeout visual no envio

No início de `finish()`:

```js
const timeoutId = setTimeout(() => {
  showLoading(
    true,
    "Ainda estamos salvando...",
    "Se demorar muito, feche o aviso e salve uma cópia local.",
    { closable: true, onClose: offerSaveCadastroLocal }
  );
}, 15000);
```

E limpar em sucesso/falha:

```js
clearTimeout(timeoutId);
```

---

## Ajustes recomendados no Apps Script (`Code.gs`)

No servidor, evite `throw new Error("Infelizmente...")` sem detalhe. Use:

```js
function submitCadastro(payload){
  try {
    if (!payload || !payload.nome || !payload.cpf || !payload.tel || !payload.email) {
      throw new Error("Campos obrigatórios ausentes: nome/cpf/tel/email");
    }

    // ...salva planilha/drive...

    return { ok: true, waUrl: "" };
  } catch (e) {
    return {
      ok: false,
      error: "submitCadastro: " + (e && e.message ? e.message : String(e))
    };
  }
}
```

Assim o front cai no `withSuccessHandler` com `res.ok=false` e mostra erro limpo.

---

## Checklist rápido de produção

- Reduzir `FILE_MAX_MB` para **3~4MB** por arquivo em mobile.
- Verificar se anexos em base64 não ultrapassam ~18MB no total.
- Garantir permissões do script/planilha/drive.
- Logar erro no servidor com contexto (etapa + tamanho de payload).
- Não enviar campos desnecessários em `payload`.

