import { test } from "@playwright/test";

// Offline/SW não pode ser testado automaticamente junto com as outras specs:
// o SW faz network-first com cache do portfolio.json.enc, bypassando
// page.route().fulfill() e mascarando a fixture. O `serviceWorkers: "block"`
// global em playwright.config.ts resolve as outras specs mas impede testar
// comportamento offline real.
//
// Cobertura offline: smoke manual no iPhone real (plano Task 15.4 + spec §4.3).
// Alternativa futura: suite "offline" dedicada com `serviceWorkers: "allow"`
// + arquivo real `portfolio.json.enc` gerado para o PIN de teste.
test.describe.skip("Offline / Service Worker", () => {
  test("skipped — conflito SW-block vs. cache-first SW", () => {});
});
