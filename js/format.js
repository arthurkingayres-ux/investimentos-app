// Formatters pt-BR (Intl nativo).

window.formatBrl = (n) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2,
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
