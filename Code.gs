/**
 * VÔ MÁQUINAS — Área do Cliente (V5) ✅📱⚡
 *
 * ✅ Fontes
 * - Cadastro: Controle Empresa Vô Máquinas > Respostas ao formulário 1
 * - Locações: PLANILHA DE ALUGUEIS > Dados
 *
 * ✅ Login atual
 * - CPF + últimos 4 dígitos do WhatsApp
 *
 * ✅ PIX atual
 * - EMV + QR (QuickChart -> base64 dataURL)
 *
 * ✅ Link mágico (token 24h reutilizável)
 * - URL abre a Área do Cliente já logada
 * - Compatível com ?open=pix para abrir "⚡ Pagar todos"
 */

/* =========================
 * CONFIG
 * ========================= */

const CFG = {
  TZ: "America/Sao_Paulo",

  CAD: {
    SPREADSHEET_ID: "1Q1hlyZRJdohiaUZq_f7UX5AjaF48Jc-mtLUcqEj4C-A",
    SHEET_NAME: "Respostas ao formulário 1",
  },

  ALUG: {
    SPREADSHEET_ID: "1vE_df5GfZWz3OopdirXunLUC2NP7btta2AS7u7RZ6KU",
    SHEET_NAME: "Dados",
    HEADER_ROW: 4,
    DATA_START_ROW: 5,
  },

  PIX: {
    KEY_CNPJ: "57168057000111",
    MERCHANT: "VO MAQUINAS",
    CITY_FALLBACK: "TRINDADE",
    TXID_PREFIX: "CT",   // CT1055
    ALL_PREFIX: "ALL",  // ALL123456
  },

  QR: {
    SIZE: 320, // QuickChart
  },

  SECURITY: {
    // Anti força-bruta simples por CPF
    RATE_LIMIT_MAX_HITS: 25,
    RATE_LIMIT_TTL_SEC: 300,
  },

  MAGIC: {
    TOKEN_TTL_SEC: 24 * 60 * 60,
    SECRET_PROP_KEY: "VO_MAQUINAS_MAGIC_SECRET",
    TOKENS_SPREADSHEET_ID: "1Q1hlyZRJdohiaUZq_f7UX5AjaF48Jc-mtLUcqEj4C-A",
    TOKENS_SHEET_NAME: "TOKENS",
    // Se quiser, fixe manualmente a URL /exec aqui (recomendado)
    WEBAPP_EXEC_URL: "https://script.google.com/macros/s/AKfycbx7XntV9P5OF8mXi04iD7T4c_wA_WBPWWf5HvKCn3SdPVZYSBlcY3oXhOJnymsSZSz1/exec",
  },
};

/* =========================
 * ENTRYPOINTS
 * ========================= */

function doGet(e) {
  return HtmlService
    .createHtmlOutputFromFile("area")
    .setTitle("Vô Máquinas • Área do Cliente")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Front chama: getCliente(cpf, tel4)
 */
function getCliente(cpf, tel4) {
  const cpfN = normalizeCPF_(cpf);
  const tel4N = onlyDigits_(tel4);

  if (cpfN.length !== 11) return { ok: false, msg: "CPF inválido. Digite 11 números." };
  if (tel4N.length !== 4) return { ok: false, msg: "Digite os 4 últimos dígitos do WhatsApp." };

  // Rate limit simples por CPF (anti força-bruta)
  const rl = rateLimitCPF_(cpfN);
  if (!rl.ok) return rl;

  // Cadastro mais recente
  const cad = getCadastroMaisRecente_(cpfN);
  if (!cad.ok) return cad;

  // Confere últimos 4 dígitos WhatsApp cadastrado
  const phoneDigits = onlyDigits_(cad.cliente.whatsapp_raw || "");
  const last4 = phoneDigits.slice(-4);
  if (last4 !== tel4N) {
    return { ok: false, msg: "Não bateu com o WhatsApp cadastrado. Confira os 4 últimos dígitos." };
  }

  return buildClienteResponseByCadastro_(cpfN, cad);
}

/**
 * Front chama: getClienteByMagic(token)
 * Abre cliente já logado sem pedir CPF/tel4.
 */
function getClienteByMagic(token) {
  const v = validateMagicToken_(token);
  if (!v.ok) return { ok: false, msg: v.msg || "Link mágico inválido ou expirado." };

  const cpfN = v.cpf;
  const cad = getCadastroMaisRecente_(cpfN);
  if (!cad.ok) return cad;

  return buildClienteResponseByCadastro_(cpfN, cad);
}

/**
 * Utilitário administrativo para gerar link mágico 24h.
 * Exemplo no editor: createMagicLink("04450931107")
 */
function createMagicLink(cpf, options) {
  const cpfN = normalizeCPF_(cpf);
  if (cpfN.length !== 11) return { ok: false, msg: "CPF inválido para gerar link." };

  const ttlSec = options && Number(options.ttlSec) > 0 ? Number(options.ttlSec) : CFG.MAGIC.TOKEN_TTL_SEC;
  const openPix = !(options && options.openPix === false);

  const token = makeMagicToken_(cpfN, ttlSec);
  const baseUrl = getWebAppExecUrl_();
  const sep = baseUrl.indexOf("?") >= 0 ? "&" : "?";
  const url = baseUrl + sep + "magic=" + encodeURIComponent(token) + (openPix ? "&open=pix" : "");

  upsertTokenRow_(token, cpfN, ttlSec);

  return {
    ok: true,
    cpf: cpfN,
    token,
    expiresAt: Utilities.formatDate(new Date(Date.now() + ttlSec * 1000), CFG.TZ, "yyyy-MM-dd HH:mm:ss"),
    url,
  };
}

function getWebAppExecUrl_() {
  const fixed = String(CFG.MAGIC.WEBAPP_EXEC_URL || "").trim();
  if (fixed) return fixed;

  // No editor, getUrl() costuma vir com /dev; para cliente final precisamos /exec.
  const raw = String(ScriptApp.getService().getUrl() || "").trim();
  if (!raw) return raw;
  return raw.replace(/\/dev(?:\?.*)?$/i, "/exec");
}

function buildClienteResponseByCadastro_(cpfN, cad) {
  const phoneDigits = onlyDigits_(cad.cliente.whatsapp_raw || "");
  const aluguel = getContratosPorCPF_(cpfN, cad.cliente);

  return {
    ok: true,
    cliente: {
      nome: cad.cliente.nome || "Cliente",
      cidade: cad.cliente.cidade || "",
      bairro: cad.cliente.bairro || "",
      whatsapp: formatPhoneBR_(phoneDigits),
      whatsapp_raw: phoneDigits,
      cliente_id: cpfN,
      cadastro_em: cad.cliente.cadastro_em || "",
    },
    contratos: aluguel.contratos || [],
    pendencias: aluguel.pendencias || [],
    payAll: aluguel.payAll || { show: false },
    summary: aluguel.summary || {},
  };
}

/* =========================
 * SECURITY
 * ========================= */

function rateLimitCPF_(cpfN) {
  const cache = CacheService.getScriptCache();
  const key = `rl:${cpfN}`;
  const hits = Number(cache.get(key) || "0");

  if (hits >= CFG.SECURITY.RATE_LIMIT_MAX_HITS) {
    return { ok: false, msg: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  cache.put(key, String(hits + 1), CFG.SECURITY.RATE_LIMIT_TTL_SEC);
  return { ok: true };
}

/* =========================
 * CADASTRO (mais recente)
 * ========================= */

function getCadastroMaisRecente_(cpfN) {
  const ss = SpreadsheetApp.openById(CFG.CAD.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CFG.CAD.SHEET_NAME);
  if (!sh) return { ok: false, msg: "Aba não encontrada: " + CFG.CAD.SHEET_NAME };

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: false, msg: "Sem dados na planilha de cadastro." };

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map((h) => String(h || "").trim());

  const idxTs = idxOf_(headers, "Carimbo de data/hora");
  const idxNome = idxOf_(headers, "Nome Completo");
  const idxTel = idxOf_(headers, "Tel. (WhatsApp)");
  const idxCPF = idxOf_(headers, "CPF");
  const idxBai = idxOf_(headers, "Bairro");
  const idxCid = idxOf_(headers, "Cidade");

  if (idxTs < 0 || idxNome < 0 || idxTel < 0 || idxCPF < 0) {
    return { ok: false, msg: "Cabeçalhos essenciais não encontrados (Carimbo/Nome/Tel/CPF)." };
  }

  let bestRow = null;
  let bestTs = null;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (normalizeCPF_(row[idxCPF]) !== cpfN) continue;

    const ts = toDate_(row[idxTs]);
    if (!ts) continue;

    if (!bestTs || ts.getTime() > bestTs.getTime()) {
      bestTs = ts;
      bestRow = row;
    }
  }

  if (!bestRow) {
    return {
      ok: false,
      msg: "CPF não encontrado no cadastro. Se acabou de cadastrar, aguarde 1 minuto e tente novamente.",
    };
  }

  return {
    ok: true,
    cliente: {
      nome: String(bestRow[idxNome] || "").trim(),
      bairro: idxBai >= 0 ? String(bestRow[idxBai] || "").trim() : "",
      cidade: idxCid >= 0 ? String(bestRow[idxCid] || "").trim() : "",
      whatsapp_raw: onlyDigits_(bestRow[idxTel] || ""),
      cadastro_em: bestTs ? Utilities.formatDate(bestTs, CFG.TZ, "yyyy-MM-dd HH:mm") : "",
    },
  };
}

/* =========================
 * LOCAÇÕES + OBS + PIX
 * ========================= */

function getContratosPorCPF_(cpfN, clienteCad) {
  const ss = SpreadsheetApp.openById(CFG.ALUG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CFG.ALUG.SHEET_NAME);
  if (!sh) return emptyAluguel_();

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < CFG.ALUG.DATA_START_ROW) return emptyAluguel_();

  const headers = sh
    .getRange(CFG.ALUG.HEADER_ROW, 1, 1, lastCol)
    .getValues()[0]
    .map((h) => String(h || "").trim());

  // Índices por nome
  const numContratoIdx = idxOfNth_(headers, "N°", 1);
  const codIdx = idxOf_(headers, "CÓD");
  const cpfIdx = idxOf_(headers, "CPF");
  const maqIdx = idxOf_(headers, "MAQUINA");
  const marcaIdx = idxOf_(headers, "MARCA");
  const modIdx = idxOf_(headers, "MOD");
  const devolIdx = idxOf_(headers, "DEVOLUÇÃO");
  const valorIdx = idxOf_(headers, "VALORES");
  const proxIdx = idxOf_(headers, "PROXIMO VENCIMENTO");
  const tDiasIdx = idxOf_(headers, "T-DIAS P/ RECEBER");

  // OBS: tenta por cabeçalho; se não achar, usa coluna K (11) -> índice 10
  let obsIdx = idxOf_(headers, "OBS");
  if (obsIdx < 0 && lastCol >= 11) obsIdx = 10;

  if (cpfIdx < 0) return emptyAluguel_();

  const nRows = lastRow - CFG.ALUG.DATA_START_ROW + 1;
  const values = sh.getRange(CFG.ALUG.DATA_START_ROW, 1, nRows, lastCol).getValues();

  const contratos = [];
  const pendencias = [];

  let activeCount = 0;
  let overdueCount = 0;
  let totalMonthly = 0;
  let nextDueDate = null;

  // PayAll
  let payAllMinDays = null;
  let payAllTotal = 0;
  let payAllHasAmount = false;

  const city = safeStr_(clienteCad && clienteCad.cidade ? clienteCad.cidade : "") || CFG.PIX.CITY_FALLBACK;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (normalizeCPF_(row[cpfIdx]) !== cpfN) continue;

    const devol = devolIdx >= 0 ? row[devolIdx] : null;
    const isActive = isBlank_(devol);

    const proxDate = proxIdx >= 0 ? toDate_(row[proxIdx]) : null;

    let tDias = null;
    if (tDiasIdx >= 0) tDias = toNumber_(row[tDiasIdx]);
    if (tDias == null && proxDate) tDias = diffDays_(new Date(), proxDate);

    const mensalNum = valorIdx >= 0 ? toNumber_(row[valorIdx]) : null;
    const obsTxt = obsIdx >= 0 ? safeStr_(row[obsIdx]) : "";

    let status = "";
    let pill = "ok";

    if (isActive) {
      activeCount++;

      if (mensalNum != null && !isNaN(mensalNum)) {
        totalMonthly += mensalNum;
        payAllTotal += mensalNum;
        payAllHasAmount = true;
      }

      if (proxDate && (!nextDueDate || proxDate.getTime() < nextDueDate.getTime())) nextDueDate = proxDate;
      if (tDias != null) {
        if (payAllMinDays == null || tDias < payAllMinDays) payAllMinDays = tDias;
      }

      if (tDias != null && tDias < 0) {
        overdueCount++;
        status = `Em atraso (${Math.abs(Math.round(tDias))}d)`;
        pill = "danger";

        pendencias.push({
          tipo: "financeiro",
          titulo: "Contrato em atraso",
          detalhe: `Contrato ${safeStr_(row[numContratoIdx])} • ${safeStr_(row[maqIdx])} • ${Math.abs(Math.round(tDias))} dias`,
        });
      } else if (tDias != null && tDias <= 3) {
        status = `Vence em ${Math.round(tDias)}d`;
        pill = "warn";
      } else {
        status = "Ativo";
        pill = "ok";
      }
    } else {
      status = "Encerrado";
      pill = "ok";
    }

    const contratoNum = numContratoIdx >= 0 ? safeStr_(row[numContratoIdx]) : "";
    const cod = codIdx >= 0 ? safeStr_(row[codIdx]) : "";
    const numeroFinal = contratoNum || cod;

    const mensalStr = mensalNum != null && !isNaN(mensalNum) ? formatMoney_(mensalNum) : "";
    const vencStr = proxDate ? formatDateBR_(proxDate) : "";

    const maquina = maqIdx >= 0 ? safeStr_(row[maqIdx]) : "";
    const marca = marcaIdx >= 0 ? safeStr_(row[marcaIdx]) : "";
    const mod = modIdx >= 0 ? safeStr_(row[modIdx]) : "";

    const pay = buildPay_(isActive, tDias, mensalNum, numeroFinal, city);

    contratos.push({
      numero: numeroFinal,
      maquina: joinParts_([maquina, marca, mod]).trim(),
      valor: mensalStr,
      venc: vencStr,
      status,
      pill,
      dias: tDias == null ? "" : Math.round(tDias),
      obs: obsTxt,
      pay,
    });
  }

  // Ordena: ativos primeiro + por vencimento
  contratos.sort((a, b) => {
    const aEnc = /Encerrado/i.test(a.status);
    const bEnc = /Encerrado/i.test(b.status);
    if (aEnc !== bEnc) return aEnc ? 1 : -1;

    const aV = parseDateBR_(a.venc);
    const bV = parseDateBR_(b.venc);
    if (aV && bV) return aV.getTime() - bV.getTime();
    if (aV && !bV) return -1;
    if (!aV && bV) return 1;

    return String(a.numero || "").localeCompare(String(b.numero || ""));
  });

  const summary = {
    activeContracts: activeCount,
    overdue: overdueCount,
    nextDue: nextDueDate ? formatDateBR_(nextDueDate) : "",
    totalMonthly: totalMonthly ? formatMoney_(totalMonthly) : "",
  };

  const payAll = buildPayAll_(activeCount, payAllMinDays, payAllHasAmount ? payAllTotal : null, cpfN, city);

  return { contratos, pendencias, payAll, summary };
}

function emptyAluguel_() {
  return { contratos: [], pendencias: [], payAll: { show: false }, summary: {} };
}

function buildPay_(isActive, tDias, amountNum, contratoNum, city) {
  if (!isActive) return { show: false };

  const days = tDias == null ? null : Math.round(tDias);
  if (days == null) return { show: false };

  // aparece a partir de 14 dias (<=14) e continua se atrasar
  if (days > 14) return { show: false };

  let tone = "green";
  let pulse = false;
  let label = "Pagar via Pix";

  if (days < 0) {
    tone = "red";
    pulse = true;
    label = "Pix em atraso";
  } else if (days === 0) {
    tone = "orange";
    pulse = true;
    label = "Pix vence hoje";
  } else if (days <= 7) {
    tone = "yellow";
    label = `Pix vence em ${days}d`;
  } else {
    tone = "green";
    label = `Pix vence em ${days}d`;
  }

  const txidDigits = String(contratoNum || "").replace(/\D/g, "");
  let txid = (CFG.PIX.TXID_PREFIX + txidDigits).slice(0, 25);
  if (!txid) txid = CFG.PIX.TXID_PREFIX;

  const emv = makePixEMV_(CFG.PIX.KEY_CNPJ, CFG.PIX.MERCHANT, city || CFG.PIX.CITY_FALLBACK, txid, amountNum);
  const qrDataUrl = makeQrDataUrl_(emv);

  return {
    show: true,
    tone,
    pulse,
    label,
    copiaCola: emv,
    qrDataUrl,
    amount: amountNum == null ? "" : formatMoney_(amountNum),
    txid,
    days,
  };
}

function buildPayAll_(activeCount, minDays, totalAmount, cpfN, city) {
  if (!activeCount || activeCount <= 0) return { show: false };
  if (minDays == null) return { show: false };
  if (Math.round(minDays) > 14) return { show: false };

  const days = Math.round(minDays);

  let tone = "green";
  let pulse = false;
  let label = "Pagar todos";

  if (days < 0) {
    tone = "red";
    pulse = true;
    label = "Pagar todos (atrasado)";
  } else if (days === 0) {
    tone = "orange";
    pulse = true;
    label = "Pagar todos (vence hoje)";
  } else if (days <= 7) {
    tone = "yellow";
    label = `Pagar todos (vence em ${days}d)`;
  } else {
    tone = "green";
    label = `Pagar todos (vence em ${days}d)`;
  }

  const txid = (CFG.PIX.ALL_PREFIX + cpfN.slice(-6)).slice(0, 25);

  const emv = makePixEMV_(CFG.PIX.KEY_CNPJ, CFG.PIX.MERCHANT, city || CFG.PIX.CITY_FALLBACK, txid, totalAmount);
  const qrDataUrl = makeQrDataUrl_(emv);

  return {
    show: true,
    tone,
    pulse,
    label,
    copiaCola: emv,
    qrDataUrl,
    amount: totalAmount == null ? "" : formatMoney_(totalAmount),
    txid,
    days,
  };
}

/* =========================
 * PIX (EMV) + QR DataURL
 * ========================= */

function makePixEMV_(key, merchantName, merchantCity, txid, amountNum) {
  const pfi = emvField_("00", "01");

  const gui = emvField_("00", "BR.GOV.BCB.PIX");
  const k = emvField_("01", String(key || "").trim());
  const mai = emvField_("26", gui + k);

  const mcc = emvField_("52", "0000");
  const cur = emvField_("53", "986");

  let amt = "";
  if (amountNum != null && !isNaN(amountNum)) {
    const a = Number(amountNum);
    if (a > 0) amt = emvField_("54", a.toFixed(2));
  }

  const ctry = emvField_("58", "BR");
  const mName = emvField_("59", normalizePixText_(merchantName || "VO MAQUINAS").slice(0, 25));
  const mCity = emvField_("60", normalizePixText_(merchantCity || "TRINDADE").slice(0, 15));

  const addTx = emvField_("05", String(txid || "CT").slice(0, 25));
  const add = emvField_("62", addTx);

  const base = pfi + mai + mcc + cur + amt + ctry + mName + mCity + add;

  const withoutCrc = base + "6304";
  const crc = crc16ccitt_(withoutCrc);
  return withoutCrc + crc;
}

function makeQrDataUrl_(text) {
  // QuickChart QR -> PNG -> base64 dataURL (compatível em qualquer conta)
  const url = "https://quickchart.io/qr?text=" + encodeURIComponent(String(text)) + "&size=" + CFG.QR.SIZE;

  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
  });

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    // fallback: sem QR, mas mantém copia e cola (não quebra UI)
    return "";
  }

  const b64 = Utilities.base64Encode(resp.getContent());
  return "data:image/png;base64," + b64;
}

function emvField_(id, value) {
  const v = String(value == null ? "" : value);
  const len = v.length;
  const ll = (len < 10 ? "0" : "") + String(len);
  return String(id) + ll + v;
}

function crc16ccitt_(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) crc = (crc << 1) ^ 0x1021;
      else crc = crc << 1;
      crc &= 0xffff;
    }
  }
  let hex = crc.toString(16).toUpperCase();
  while (hex.length < 4) hex = "0" + hex;
  return hex;
}

function normalizePixText_(s) {
  let t = String(s || "").toUpperCase().trim();
  t = t
    .replace(/[ÁÀÂÃ]/g, "A")
    .replace(/[ÉÈÊ]/g, "E")
    .replace(/[ÍÌÎ]/g, "I")
    .replace(/[ÓÒÔÕ]/g, "O")
    .replace(/[ÚÙÛ]/g, "U")
    .replace(/Ç/g, "C");
  t = t.replace(/[^A-Z0-9 \-\.]/g, "");
  return t;
}

/* =========================
 * MAGIC TOKEN (24h)
 * ========================= */

function makeMagicToken_(cpfN, ttlSec) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payloadObj = {
    cpf: cpfN,
    exp: nowSec + Math.max(60, Number(ttlSec) || CFG.MAGIC.TOKEN_TTL_SEC),
    nonce: Utilities.getUuid().replace(/-/g, "").slice(0, 12),
  };

  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = toB64WebSafeNoPad_(payloadJson);
  const sigB64 = signMagicPayload_(payloadB64);
  return payloadB64 + "." + sigB64;
}

function validateMagicToken_(token) {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, msg: "Token ausente." };

  const parts = raw.split(".");
  if (parts.length !== 2) return { ok: false, msg: "Formato de token inválido." };

  const payloadB64 = normalizeB64WebSafe_(parts[0]);
  const sigB64 = normalizeB64WebSafe_(parts[1]);
  const expectedSig = normalizeB64WebSafe_(signMagicPayload_(payloadB64));

  if (!safeEqual_(sigB64, expectedSig)) {
    return { ok: false, msg: "Assinatura do link inválida." };
  }

  let payloadObj;
  try {
    const payloadJson = fromB64WebSafe_(payloadB64);
    payloadObj = JSON.parse(payloadJson);
  } catch (err) {
    return { ok: false, msg: "Token corrompido." };
  }

  const cpfN = normalizeCPF_(payloadObj && payloadObj.cpf);
  const exp = Number(payloadObj && payloadObj.exp);
  const nowSec = Math.floor(Date.now() / 1000);

  if (cpfN.length !== 11) return { ok: false, msg: "CPF inválido no token." };
  if (!exp || exp < nowSec) return { ok: false, msg: "Link expirado. Solicite um novo link." };

  // Validação extra em planilha TOKENS (se existir)
  const row = getTokenRow_(raw);
  if (row && row.ok) {
    if (!row.ativo) return { ok: false, msg: "Link desativado. Solicite um novo." };
    if (row.refCliente && normalizeCPF_(row.refCliente) !== cpfN) {
      return { ok: false, msg: "Token não pertence ao cliente." };
    }
    if (row.expiraEm && row.expiraEm.getTime() < Date.now()) {
      return { ok: false, msg: "Link expirado. Solicite um novo link." };
    }
    markTokenUsed_(row.rowIndex);
  }

  return { ok: true, cpf: cpfN };
}

function signMagicPayload_(payloadB64) {
  const secret = getMagicSecret_();
  const bytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  return toB64WebSafeNoPad_(bytes);
}

function getMagicSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty(CFG.MAGIC.SECRET_PROP_KEY);
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(CFG.MAGIC.SECRET_PROP_KEY, s);
  }
  return s;
}

function safeEqual_(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}

function normalizeB64WebSafe_(s) {
  return String(s || "").trim().replace(/\s+/g, "").replace(/=+$/g, "");
}

function toB64WebSafeNoPad_(value) {
  const encoded = Array.isArray(value)
    ? Utilities.base64EncodeWebSafe(value)
    : Utilities.base64EncodeWebSafe(String(value));
  return normalizeB64WebSafe_(encoded);
}

function fromB64WebSafe_(s) {
  const noPad = normalizeB64WebSafe_(s);
  const padLen = (4 - (noPad.length % 4)) % 4;
  const padded = noPad + "=".repeat(padLen);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
}


function getTokensSheet_() {
  try {
    const ss = SpreadsheetApp.openById(CFG.MAGIC.TOKENS_SPREADSHEET_ID);
    let sh = ss.getSheetByName(CFG.MAGIC.TOKENS_SHEET_NAME);
    if (!sh) sh = ss.insertSheet(CFG.MAGIC.TOKENS_SHEET_NAME);

    if (sh.getLastRow() < 1) {
      sh.getRange(1, 1, 1, 8).setValues([["TOKEN", "REF_CLIENTE", "MODO", "CRIADO_EM", "EXPIRA_EM", "ATIVO", "ULTIMO_USO", "IP_HASH"]]);
    }
    return sh;
  } catch (err) {
    return null;
  }
}

function upsertTokenRow_(token, cpfN, ttlSec) {
  const sh = getTokensSheet_();
  if (!sh) return;

  const now = new Date();
  const exp = new Date(now.getTime() + Number(ttlSec) * 1000);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    sh.appendRow([token, cpfN, "MAGIC", now, exp, true, "", ""]);
    return;
  }

  const vals = sh.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() === token) {
      sh.getRange(i + 2, 2, 1, 6).setValues([[cpfN, "MAGIC", now, exp, true, ""]]);
      return;
    }
  }

  sh.appendRow([token, cpfN, "MAGIC", now, exp, true, "", ""]);
}

function getTokenRow_(token) {
  const sh = getTokensSheet_();
  if (!sh) return null;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const vals = sh.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() === token) {
      return {
        ok: true,
        rowIndex: i + 2,
        refCliente: String(vals[i][1] || "").trim(),
        ativo: toBool_(vals[i][5]),
        expiraEm: toDate_(vals[i][4]),
      };
    }
  }
  return null;
}

function markTokenUsed_(rowIndex) {
  const sh = getTokensSheet_();
  if (!sh || !rowIndex || rowIndex < 2) return;
  sh.getRange(rowIndex, 7).setValue(new Date());
}

function toBool_(v) {
  if (typeof v === "boolean") return v;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "sim" || s === "ativo";
}

// Helper rápido para testes no editor do Apps Script.
// Ajuste o CPF abaixo e execute esta função para ver a URL nos logs.
function testCreateMagicLink_() {
  const cpfTeste = "03790850110";
  const out = createMagicLink(cpfTeste, { openPix: true });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Versão pública para aparecer no menu Executar do Apps Script.
function testCreateMagicLink() {
  const out = testCreateMagicLink_();
  Logger.log("URL /exec fixa: " + getWebAppExecUrl_());
  Logger.log("Abra em aba anônima: " + out.url);
  return out;
}

function debugWebAppUrl() {
  const raw = String(ScriptApp.getService().getUrl() || "");
  const finalUrl = getWebAppExecUrl_();
  Logger.log(JSON.stringify({ raw, finalUrl }, null, 2));
  return { raw, finalUrl };
}

/* =========================
 * UTILS
 * ========================= */

function onlyDigits_(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

function normalizeCPF_(v) {
  let d = onlyDigits_(v);
  if (d.length === 10) d = "0" + d;
  return d;
}

function idxOf_(headers, name) {
  const target = String(name).trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim().toLowerCase() === target) return i;
  }
  return -1;
}

function idxOfNth_(headers, name, nth) {
  const target = String(name).trim().toLowerCase();
  let count = 0;
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim().toLowerCase() === target) {
      count++;
      if (count === nth) return i;
    }
  }
  return -1;
}

function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (v == null || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toNumber_(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function safeStr_(v) {
  if (v == null) return "";
  if (v instanceof Date) return formatDateBR_(v);
  return String(v).trim();
}

function isBlank_(v) {
  if (v == null) return true;
  if (v instanceof Date) return false;
  const s = String(v).trim();
  return s === "";
}

function formatPhoneBR_(digits) {
  const d = String(digits || "");
  if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 3) + " " + d.slice(3, 7) + "-" + d.slice(7);
  if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  return d;
}

function formatDateBR_(dateObj) {
  return Utilities.formatDate(dateObj, CFG.TZ, "dd/MM/yyyy");
}

function formatMoney_(n) {
  if (n == null) return "";
  const v = Number(n);
  if (isNaN(v)) return "";
  return v.toFixed(2).replace(".", ",");
}

function joinParts_(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const s = String(arr[i] || "").trim();
    if (s) out.push(s);
  }
  return out.join(" • ");
}

function parseDateBR_(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function diffDays_(d1, d2) {
  const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}
