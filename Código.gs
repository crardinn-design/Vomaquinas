/**
 * VÔ MÁQUINAS - Backend (Apps Script)
 * Ajustado para:
 * 1) manter validações de envio;
 * 2) quando houver erro, retornar sugestão estruturada para o front:
 *    - HTML completo com dados + anexos;
 *    - botão para salvar em PDF no dispositivo (window.print);
 *    - botão para chamar WhatsApp da empresa.
 */

const CFG = {
  TIMEZONE: "America/Sao_Paulo",
  COMPANY_WA: "556294091954",
  MAX_TOTAL_FILES_MB: 18,
  MAX_SINGLE_FILE_MB: 8
};

function doGet() {
  let out;
  try {
    out = HtmlService.createHtmlOutputFromFile("index");
  } catch (e1) {
    try {
      out = HtmlService.createHtmlOutputFromFile("Index");
    } catch (e2) {
      out = HtmlService.createHtmlOutput(
        "<h3>Erro ao carregar página inicial</h3><p>Arquivo HTML não encontrado (index/Index).</p>"
      );
    }
  }

  return out
    .setTitle("Cadastro Vô Máquinas")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function api_ping() {
  return { ok: true, ts: new Date().toISOString() };
}

function api_getLoggedEmail() {
  try {
    const email = Session.getActiveUser().getEmail();
    return { ok: true, email: String(email || "") };
  } catch (e) {
    return { ok: false, email: "", error: String(e) };
  }
}

function api_getGoogleAuthConfig() {
  return { ok: true, clientId: "", enabled: false, provider: "google.accounts.id" };
}

function api_verifyGoogleIdToken(idToken) {
  return {
    ok: false,
    error: "Validação de Google ID Token desativada neste patch.",
    tokenReceived: !!String(idToken || "").trim()
  };
}

function getCep(cep) {
  try {
    const clean = String(cep || "").replace(/\D/g, "");
    if (clean.length !== 8) return { ok: false, error: "CEP inválido" };

    const resp = UrlFetchApp.fetch(`https://viacep.com.br/ws/${clean}/json/`, { muteHttpExceptions: true });
    const data = JSON.parse(resp.getContentText() || "{}");

    if (resp.getResponseCode() !== 200 || data.erro) {
      return { ok: false, error: "CEP não encontrado" };
    }

    return {
      ok: true,
      logradouro: data.logradouro || "",
      bairro: data.bairro || "",
      localidade: data.localidade || "",
      uf: data.uf || ""
    };
  } catch (e) {
    return { ok: false, error: "Erro no ViaCEP: " + String(e) };
  }
}

function safeText(v) { return String(v == null ? "" : v).trim(); }
function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }
function toMb_(bytes) { return Number(bytes || 0) / 1024 / 1024; }

function dataUrlBase64SizeBytes_(dataUrl) {
  const value = String(dataUrl || "");
  const m = value.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return 0;
  const b64 = m[1];
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : (b64.endsWith("=") ? 1 : 0);
  return Math.floor((len * 3) / 4) - padding;
}

function inspectFilesPayload_(filesObj) {
  const out = { totalBytes: 0, invalidKeys: [], oversizedKeys: [], files: [] };

  Object.keys(filesObj || {}).forEach((key) => {
    const f = filesObj[key] || {};
    const data = String(f.data || "");
    if (!data) return;

    if (!/^data:[^;]+;base64,/.test(data)) {
      out.invalidKeys.push(key);
      return;
    }

    const bytes = dataUrlBase64SizeBytes_(data);
    const mb = toMb_(bytes);
    out.totalBytes += bytes;
    out.files.push({ key, bytes, mb: Number(mb.toFixed(2)) });

    if (mb > CFG.MAX_SINGLE_FILE_MB) out.oversizedKeys.push(key);
  });

  return out;
}

function buildWhatsAppUrl_(phoneDigits, text) {
  const phone = onlyDigits(phoneDigits);
  const msg = encodeURIComponent(String(text || ""));
  return `https://api.whatsapp.com/send?phone=${phone}&text=${msg}`;
}


function encodeUtf8Base64_(text) {
  const bytes = Utilities.newBlob(String(text || "")).getBytes();
  return Utilities.base64Encode(bytes);
}

function escHtml_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildBackupHtml_(payload, reason) {
  const p = payload || {};
  const files = p.files || {};
  const refs = [
    `${safeText(p.ref1_nome)} — ${onlyDigits(p.ref1_tel)}`,
    `${safeText(p.ref2_nome)} — ${onlyDigits(p.ref2_tel)}`,
    `${safeText(p.ref3_nome)} — ${onlyDigits(p.ref3_tel)}`
  ].filter(v => v.replace(/[\s—-]/g, "").length);

  const row = (k, v) => `<tr><th>${escHtml_(k)}</th><td>${escHtml_(v || "—")}</td></tr>`;

  const fileBlock = (label, f) => {
    if (!f || !f.data) return "";
    const type = String(f.type || "");
    const isImg = type.indexOf("image/") === 0;
    const isPdf = type.indexOf("pdf") >= 0;
    const preview = isImg
      ? `<img src="${f.data}" alt="${escHtml_(label)}" style="max-width:100%;border:1px solid #ddd;border-radius:8px;"/>`
      : (isPdf
          ? `<embed src="${f.data}" type="application/pdf" style="width:100%;height:520px;border:1px solid #ddd;border-radius:8px;"/>`
          : `<a href="${f.data}" target="_blank" rel="noopener">Abrir arquivo</a>`);

    return `
      <section style="margin-top:16px;">
        <h3 style="margin:0 0 8px 0;">${escHtml_(label)}</h3>
        <div style="margin-bottom:8px;"><b>Arquivo:</b> ${escHtml_(safeText(f.name) || "sem nome")}</div>
        ${preview}
      </section>
    `;
  };

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cadastro Vô Máquinas - Backup</title>
  <style>
    body{font-family:Arial,sans-serif;padding:20px;color:#1f2937;line-height:1.35}
    table{border-collapse:collapse;width:100%;max-width:980px}
    th,td{border:1px solid #d9d9d9;padding:8px;vertical-align:top}
    th{background:#f5f7f8;text-align:left;width:240px}
    .top{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
    .btn{padding:12px 14px;border:none;border-radius:10px;font-weight:700;cursor:pointer}
    .btn-save{background:#25D366;color:#06110c}
  </style>
</head>
<body>
  <h1 style="margin:0;">Cadastro Vô Máquinas - Backup</h1>
  <p style="margin:6px 0 10px 0;color:#555;">Este arquivo foi gerado após falha no envio automático.</p>
  <p style="margin:0 0 12px 0;"><b>Motivo:</b> ${escHtml_(reason || "Erro no envio")}</p>

  <div class="top">
    <button class="btn btn-save" onclick="window.print()">💾 Salvar em PDF no dispositivo</button>
  </div>

  <table>
    ${row("Data/Hora", Utilities.formatDate(new Date(), CFG.TIMEZONE, "dd/MM/yyyy HH:mm:ss"))}
    ${row("Nome", safeText(p.nome))}
    ${row("CPF/CNPJ", onlyDigits(p.cpf))}
    ${row("WhatsApp", onlyDigits(p.tel))}
    ${row("E-mail", safeText(p.email))}
    ${row("Máquinas", safeText(p.maquinas_txt))}
    ${row("Nascimento", safeText(p.data_nasc))}
    ${row("RG", safeText(p.rg))}
    ${row("Nacionalidade", safeText(p.nacionalidade))}
    ${row("Profissão", safeText(p.profissao))}
    ${row("Estado civil", safeText(p.estado_civil))}
    ${row("Endereço principal", safeText(p.endereco))}
    ${row("Endereço entrega", safeText(p.entrega_endereco || p.endereco))}
    ${row("Referências", refs.join(" | "))}
    ${row("Referência", safeText(p.referencia))}
    ${row("Observações", safeText(p.obs))}
  </table>

  ${fileBlock("Selfie", files.FILE_SELFIE)}
  ${fileBlock("Documento - Frente", files.FILE_FRENTE)}
  ${fileBlock("Documento - Verso", files.FILE_VERSO)}
  ${fileBlock("Comprovante", files.FILE_COMP)}
</body>
</html>`;
}

function buildErrorSuggestion_(payload, errorMsg) {
  const reason = safeText(errorMsg) || "Falha ao enviar cadastro";
  const waText = [
    "⚠️ Falha no envio automático do cadastro.",
    `Motivo: ${reason}`,
    `Cliente: ${safeText(payload && payload.nome) || "(não informado)"}`,
    "Gerei o arquivo de backup em HTML/PDF para envio manual."
  ].join("\n");

  return {
    title: "Não conseguimos enviar agora",
    message: "Salve o cadastro em PDF e envie para a equipe pelo WhatsApp.",
    saveButtonLabel: "💾 Salvar em PDF",
    whatsappButtonLabel: "📲 Chamar no WhatsApp da empresa",
    backupHtml: encodeUtf8Base64_(buildBackupHtml_(payload || {}, reason)),
    waText,
    waUrl: buildWhatsAppUrl_(CFG.COMPANY_WA, waText),
    companyWa: CFG.COMPANY_WA
  };
}

function safeServerError_(e) {
  if (!e) return "Erro desconhecido no servidor.";
  const msg = safeText(e.message || e.toString());
  const stack = safeText(e.stack);
  if (!stack) return msg || "Erro desconhecido no servidor.";
  return `${msg} (${stack.split("\n").slice(0, 2).join(" | ")})`;
}

function submitCadastro(payload) {
  try {
    payload = payload || {};

    const nome = safeText(payload.nome);
    const cpfCnpj = onlyDigits(payload.cpf);
    const tel = onlyDigits(payload.tel);
    const email = safeText(payload.email);

    if (!nome) {
      const err = "Nome é obrigatório.";
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }
    if (!cpfCnpj) {
      const err = "CPF/CNPJ é obrigatório.";
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }
    if (!tel) {
      const err = "WhatsApp é obrigatório.";
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }
    if (!email) {
      const err = "E-mail é obrigatório.";
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }

    const filesInfo = inspectFilesPayload_(payload.files || {});
    const totalMb = toMb_(filesInfo.totalBytes);

    if (filesInfo.invalidKeys.length) {
      const err = `Arquivos inválidos no payload: ${filesInfo.invalidKeys.join(", ")}.`;
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }

    if (filesInfo.oversizedKeys.length) {
      const err = `Arquivo(s) acima de ${CFG.MAX_SINGLE_FILE_MB}MB: ${filesInfo.oversizedKeys.join(", ")}.`;
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }

    if (totalMb > CFG.MAX_TOTAL_FILES_MB) {
      const err = `Tamanho total dos anexos excede o limite (${totalMb.toFixed(1)}MB > ${CFG.MAX_TOTAL_FILES_MB}MB).`;
      return { ok: false, error: err, suggestion: buildErrorSuggestion_(payload, err) };
    }

    // Aqui deve seguir o fluxo real de persistência (planilha/Drive/email).

    const waText = "✅ Cadastro recebido com sucesso.\nFavor confirmar o atendimento.";
    return {
      ok: true,
      message: "Cadastro recebido com sucesso.",
      diagnostics: {
        filesCount: filesInfo.files.length,
        totalFilesMb: Number(totalMb.toFixed(2))
      },
      waText,
      waUrl: buildWhatsAppUrl_(CFG.COMPANY_WA, waText),
      companyWa: CFG.COMPANY_WA
    };
  } catch (e) {
    const err = "Erro no servidor: " + safeServerError_(e);
    return {
      ok: false,
      error: err,
      suggestion: buildErrorSuggestion_(payload || {}, err)
    };
  }
}
