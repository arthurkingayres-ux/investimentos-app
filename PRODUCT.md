# Product

## Register

product

## Users

Um único usuário, o dono da carteira: médico cirurgião em formação, com
responsabilidades clínicas longas e horários imprevisíveis. Investe no Brasil e
nos Estados Unidos desde 2019, e a carteira é 100% do patrimônio destinado à
aposentadoria. Abre o app quase sempre do celular. Não há login multi-tenant,
não há público externo, não há tela compartilhada.

A tarefa muda por momento:

- **Olhada rápida**, a maioria das aberturas: "como está hoje, e tem algo que
  precisa de mim agora?" — resposta na primeira tela, sem tocar em nada.
- **Análise dedicada**, mensal ou trimestral: drilldown por classe, por ativo e
  por janela de tempo; comparação com a mesma carteira feita só de índices;
  diagnóstico de risco, seleção, política e construção; projeção e renda.
- **Decisão de aporte:** onde está abaixo do alvo, quanto comprar de cada
  ativo, e o registro das rodadas do Comitê.
- **IRPF:** custo médio e proventos consolidados por ano.

## O que o app é

PWA mobile-first, **projeção read-only** do banco. O sistema autoritativo é um
SQLite (`investimentos.db`) reconstruído a partir dos documentos originais —
notas de corretagem, extratos, informes, eventos da B3. O pipeline em Python
gera um snapshot cifrado (`portfolio.json.enc`, mais os dossiês, relatórios e
payloads do Comitê e da vigília) e o publica neste repositório; o app é servido
por um Worker da Cloudflare atrás do Access.

**O app nunca escreve no SQLite.** Toda mudança de dado entra pelo pipeline, a
partir de um documento. Offline-first: o service worker serve o shell e o último
payload conhecido, então uma abertura sem rede mostra os números da última
publicação.

O acesso é por uma **frase**, que decifra os payloads e vive só em memória. O
aparelho guarda um envelope local cifrado com um PIN, para não precisar digitar
a frase toda vez; a sessão desliza por 7 dias. Nada de biometria — luva
cirúrgica não desbloqueia nada.

Navegação em dois níveis: cinco grupos na barra de baixo (Raio-X · Retorno ·
Carteira · Análise · Aportar) e, em cada grupo, uma faixa com as telas dele. As
telas de um ativo (posição, dossiê, retorno) e os capítulos do diagnóstico são
telas de push, com "←".

## Compromissos de produto

Estes não são gosto; são fronteira. Valem independentemente de como o app vier a
parecer.

- **Confiança no número.** Todo dado é rastreável ao documento-fonte. Valor sem
  fonte não aparece: ausência rende `—`, nunca um zero que pareça medido.
- **O app informa, não recomenda.** Nenhum verbo de ordem de compra ou venda,
  nenhum nudge de ação. Ele mostra o que é e o que está fora do alvo; a decisão
  é do usuário. O validador da vigília cobra isso como `VERBO_DE_ORDEM`.
- **Qual número aparece, com que valor, em que ordem, qual ativo é selecionado,
  o que vem oculto por default, e a copy que nomeia métrica, janela, unidade ou
  moeda** são decisão do dono da carteira, não de quem implementa.
- **Acessibilidade funcional:** alvo de toque de 44px, contraste legível,
  leitura de tela (equivalente textual para todo desenho), e
  `prefers-reduced-motion` honrado. Animação em loop, se um dia houver, precisa
  de controle de pausa.
- **Sinal usa forma + texto + cor, nunca cor sozinha.** Ganho e perda levam
  glifo, valor escrito e cor; selo de tese leva glifo, grau por extenso e cor.
  É o que mantém a tela legível em deuteranopia.
- **Texto base de 16px**, com zoom do sistema sem quebrar layout.
- **A reserva de emergência não é carteira.** Fica fora do hero, não é somada a
  número nenhum da carteira e não entra em alocação, rentabilidade nem projeção.
- **Repositório público.** Fixture de teste é sintética; nada de patrimônio,
  peso real, CPF, conta ou nome completo entra aqui.
