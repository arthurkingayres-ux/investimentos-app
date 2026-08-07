/**
 * SMOKE DESCARTAVEL — falha deliberada para provar o canal de alerta (7a.AA.3).
 *
 * Este arquivo NAO deve ser mergeado em `main`. Ele existe para produzir um run
 * de CI vermelho de verdade, porque a spec §6.2 exige e-mail RECEBIDO e nao
 * "envio sem erro" — esta casa ja teve um canal que passou um mes morrendo num
 * SMTPAuthenticationError engolido.
 */
import { test, expect } from "@playwright/test";

test("smoke: falha deliberada (7a.AA.3) — este teste TEM de falhar", () => {
  expect(1, "falha deliberada do smoke do canal de alerta").toBe(2);
});
