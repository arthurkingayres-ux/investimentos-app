// Formatters pt-BR (Intl nativo).

window.formatBrl = (n) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2,
}).format(n ?? 0);

// Igual a formatBrl mas com sinal explícito ("+R$ 920,00" / "−R$ 4.180,00").
// Para o impacto de mercado (#raiox movers): o sinal carrega significado de
// direção (somou vs tirou do patrimônio) e dá a leitura por leitor de tela
// quando a seta ▲/▼ é decorativa (aria-hidden). signDisplay "exceptZero"
// não prefixa o zero.
window.formatBrlSigned = (n) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2,
  signDisplay: "exceptZero",
}).format(n ?? 0);

// Helper interno: aceita signDisplay como param para evitar duplicação
// entre formatPct e formatPctSemSinal.
const _fmtPct = (decimal, digits, signDisplay) => {
  if (decimal === null || decimal === undefined || Number.isNaN(decimal)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay,
  }).format(decimal);
};

// Entrada em decimal (0.1296 → +12,96%). Para métricas que podem ser
// negativas: XIRR, TWR, drift, variação semanal, ganho/perda.
window.formatPct = (decimal, digits = 2) => _fmtPct(decimal, digits, "exceptZero");

// Versão sem sinal: para valores inerentemente não-negativos (alocação
// por classe, peso na classe). signDisplay "auto" só prepend "-" em
// negativos — nunca "+". Usar quando "+21,5%" não tem semântica de oposto.
window.formatPctSemSinal = (decimal, digits = 2) => _fmtPct(decimal, digits, "auto");

window.formatDataHora = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dia} · ${hora}`;
};

window.formatDataCurta = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
};

// 7a.Q.3: converte "YYYY-MM" para "Mês Ano" em pt-BR ("2026-05" → "Maio 2026").
const _MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
window.formatMesAno = (mes) => {
  if (typeof mes !== "string" || mes.length !== 7) return "";
  const ano = mes.slice(0, 4), mm = parseInt(mes.slice(5), 10);
  if (!(mm >= 1 && mm <= 12)) return "";
  return `${_MESES_PT[mm - 1]} ${ano}`;
};

// 7a.S.10: "YYYY-MM-DD" → "12 de junho" (dia + mês por extenso, sem ano —
// legenda do apcap do simulador de aporte). Parse por regex (NÃO
// `new Date(iso)`): datas ISO sem hora viram meia-noite UTC — em
// America/Sao_Paulo (UTC-3) isso volta pro dia anterior no horário local
// (new Date("2026-04-20").getDate() === 19). Regex evita o fuso inteiramente.
window.formatDataExtenso = (iso) => {
  if (typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const mes = parseInt(m[2], 10);
  if (!(mes >= 1 && mes <= 12)) return "";
  return `${parseInt(m[3], 10)} de ${_MESES_PT[mes - 1].toLowerCase()}`;
};

// 7a.AE.3: "YYYY-MM-DD" -> "18/08" (dia/mes, sem ano — o hero e o slot mais
// apertado da tela e o ano e redundante numa data de pregao recente).
// Parse por REGEX e nao `new Date(iso)`, pelo mesmo motivo de fuso ja
// documentado em formatDataExtenso: data ISO sem hora vira meia-noite UTC e,
// em America/Sao_Paulo (UTC-3), volta pro dia anterior
// (`new Date("2026-08-18").getDate() === 17`). Aqui o bug seria especialmente
// cruel: uma linha errada de fuso faria o app confessar o PREGAO ERRADO, que e
// exatamente o defeito que a fase 7a.AE existe para corrigir.
window.formatDataDiaMes = (iso) => {
  if (typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  // Valida a FAIXA, e nao so a forma — os irmaos formatDataExtenso e
  // formatMesAno ja validam, e ali a razao e indexar _MESES_PT. Aqui nao ha
  // indexacao, entao "2026-13-40" renderizaria "40/13" sem erro: uma data
  // impossivel afirmada com a mesma confianca de uma real, no slot cuja
  // unica funcao e ser confiavel sobre a data. Achado do general-swe-reviewer
  // no CRB da 7a.AE.3.
  const mes = parseInt(m[2], 10);
  const dia = parseInt(m[3], 10);
  if (!(mes >= 1 && mes <= 12) || !(dia >= 1 && dia <= 31)) return "";
  return `${m[3]}/${m[2]}`;
};

// 7a.R.3.b: "YYYY-MM-DD" → "31/12/2024" (linha de frescor + tese revisada em).
// Parse por regex (NÃO `new Date(iso)`): data ISO sem hora vira meia-noite UTC
// e, em America/Sao_Paulo (UTC-3), volta pro dia anterior — mesmo motivo já
// documentado em formatDataExtenso.
window.formatDataIso = (iso) => {
  if (typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

// 7a.R.3.b: "2024-12-31" → "DEZ 2024" — linha-marco da entrada de timeline.
// Abreviação DERIVADA de _MESES_PT (sem segunda tabela de meses no arquivo);
// regex pelo mesmo motivo de fuso acima.
window.formatMarcoMes = (iso) => {
  if (typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const mm = parseInt(m[2], 10);
  if (!(mm >= 1 && mm <= 12)) return "";
  return `${_MESES_PT[mm - 1].slice(0, 3).toUpperCase()} ${m[1]}`;
};
