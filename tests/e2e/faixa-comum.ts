import { expect, Page } from "@playwright/test";

// 7a.CC.2: os cartões do Hoje saíram; quem entrava por eles entra pelo caminho
// de navegação de verdade: toque no grupo na barra e, depois, na tela da faixa.
export async function irPelaFaixa(page: Page, grupo: string, hash: string) {
  await page.locator(`.tab-bar a[data-tab="${grupo}"]`).click();
  const item = page.locator(`.grupo-cab .faixa a[href="${hash}"]`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(item).toHaveAttribute("aria-current", "page");
}
