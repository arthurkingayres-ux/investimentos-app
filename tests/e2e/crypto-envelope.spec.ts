import { test, expect } from "@playwright/test";

// 7a.W.3.a — `cifrar` existe só para o envelope local. O que ela produz tem
// de ser lido por `decifrar` (mesmo layout) e, no repo principal, por
// `decriptar_json` — a paridade Python↔JS da CIFRA já é coberta na direção
// oposta por tests/test_crypto_paridade.py.
test.describe("crypto: cifrar/decifrar e canonicalizarFrase", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/");
  });

  test("round-trip cifrar → decifrar devolve o plaintext", async ({ page }) => {
    const saida = await page.evaluate(async () => {
      const enc = await (window as any).cifrar("conteudo sintetico de teste", "123456");
      return {
        b64: typeof enc === "string" && enc.length > 0,
        volta: await (window as any).decifrar(enc, "123456"),
      };
    });
    expect(saida.b64).toBe(true);
    expect(saida.volta).toBe("conteudo sintetico de teste");
  });

  test("segredo errado não decifra o envelope", async ({ page }) => {
    const falhou = await page.evaluate(async () => {
      const enc = await (window as any).cifrar("conteudo sintetico", "123456");
      try {
        await (window as any).decifrar(enc, "999999");
        return false;
      } catch {
        return true;
      }
    });
    expect(falhou).toBe(true);
  });

  test("cifrar duas vezes o mesmo conteudo produz bytes diferentes (IV aleatorio)", async ({ page }) => {
    // Não é curiosidade: é o mesmo fato que forçou o diff change-aware da
    // 7a.R.3.a. Se um dia isto passar a ser determinístico, o IV virou fixo.
    const iguais = await page.evaluate(async () => {
      const a = await (window as any).cifrar("x", "123456");
      const b = await (window as any).cifrar("x", "123456");
      return a === b;
    });
    expect(iguais).toBe(false);
  });

  test("canonicalizarFrase normaliza caso, espaco e NFD", async ({ page }) => {
    const r = await page.evaluate(() => {
      const f = (window as any).canonicalizarFrase;
      return {
        caso: f("ALFA Beta"),
        espaco: f("  alfa \t beta\n"),
        nfd: f("barão"),
        vazia: f(""),
        naoString: f(null),
      };
    });
    expect(r.caso).toBe("alfa beta");
    expect(r.espaco).toBe("alfa beta");
    expect(r.nfd).toBe("barão");
    expect(r.vazia).toBe("");
    expect(r.naoString).toBe("");
  });
});
