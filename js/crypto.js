// Decifra payload_b64 → plaintext (string) usando PIN.
// Paridade com src/output/crypto.py (PBKDF2-HMAC-SHA256 600k + AES-256-GCM).

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;

async function derivarChave(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(pin), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decifrar(payloadB64, pin) {
  const bytes = Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0));
  const salt = bytes.slice(0, SALT_LENGTH);
  const nonce = bytes.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
  const ciphertext = bytes.slice(SALT_LENGTH + NONCE_LENGTH);
  const key = await derivarChave(pin, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce }, key, ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

// 7a.W.3.a — `cifrar`: contraparte de `decifrar`, mesmo layout de arquivo
// (salt[16] + nonce[12] + ciphertext+tag). Existe para UM propósito: criar o
// envelope local (o segredo cifrado sob o PIN do aparelho). Não é usada para
// nada publicado — quem publica é o Python.
async function derivarChaveCifra(segredo, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(segredo), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

async function cifrar(plaintext, segredo) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const key = await derivarChaveCifra(segredo, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext)
  ));
  const payload = new Uint8Array(salt.length + nonce.length + ct.length);
  payload.set(salt, 0);
  payload.set(nonce, salt.length);
  payload.set(ct, salt.length + nonce.length);
  let bin = "";
  for (let i = 0; i < payload.length; i++) bin += String.fromCharCode(payload[i]);
  return btoa(bin);
}

// 7a.W — forma canônica do segredo. ESPELHO EXATO de
// `canonicalizar_frase` em src/output/segredo.py; a paridade é travada por
// tests/test_canonicalizacao_paridade.py, que carrega ESTE arquivo no Node.
//
//     canonicalizarFrase(s) = NFC( s.trim().toLowerCase().split(/\s+/).join(" ") )
//
// `trim` + split por `\s+` colapsa espaço duplo, tab e quebra de linha (colar
// do cofre traz lixo). `toLowerCase` absorve o autocapitalize do teclado. NFC
// fecha o bug em que `barão` digitado no iPhone (NFD) e `barão` do gerador
// (NFC) viram BYTES diferentes e portanto CHAVES diferentes.
//
// A ORDEM (toLowerCase antes de NFC) é CONTRATO com o lado Python, não
// otimização: medido em 30/07/2026, nenhum caso do corpus produz resultado
// diferente com as etapas invertidas. O corpus prova que os dois lados
// CONCORDAM, não que a ordem importa.
//
// O `filter(Boolean)` não é decorativo: `"".split(/\s+/)` devolve `[""]`, e
// sem ele a string vazia canonicalizaria para `""` por acidente em vez de por
// construção, e `"  a  "` traria token vazio na ponta em alguns motores.
function canonicalizarFrase(s) {
  if (typeof s !== "string") return "";
  return s.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ").normalize("NFC");
}

window.decifrar = decifrar;
window.cifrar = cifrar;
window.canonicalizarFrase = canonicalizarFrase;
