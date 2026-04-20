// Formatters pt-BR (Intl nativo).

window.formatBrl = (n) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2,
}).format(n ?? 0);

// Entrada em decimal (0.1296 → +12,96%).
window.formatPct = (decimal, digits = 2) => {
  if (decimal === null || decimal === undefined || Number.isNaN(decimal)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(decimal);
};

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
