# 💿 CD Import Tracker

Aplicação web **Single Page Application (SPA)** desenvolvida com **Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Clerk Auth + Upstash Redis** para gerenciar a compra e importação de CDs e Box Sets no exterior (eBay UK, EUA, Europa, Japão), consolidação de pacotes em redirecionadores de encomendas e cálculo automático do rateio de fretes e impostos alfandegários em Reais (`BRL`).

---

## ✨ Funcionalidades Principais

### 1. Arquitetura Master / Detail Responsiva (Desktop & Mobile)
- **Aba "Visão por Pacotes" (Master / Detail):**
  - **Coluna Esquerda (Master — Lista de Pacotes):**
    - Exibe todos os pacotes/lotes cadastrados com **Nome Gerado Automaticamente** (ou personalizado com trava), **Peso em kg**, **Badge de Status**, **Modo de Consolidação**, **Quantidade de CDs** e **Custo Total em BRL**.
    - **6 Status do Fluxo de Importação:**
      - `🛒 Comprado (Pacote Único)`
      - `📍 No Redirecionador (Avulso)`
      - `📦 Já Consolidado (No Redirecionador)`
      - `✈️ Em Trânsito`
      - `🧾 Tributado (Receita/MG)`
      - `✅ Entregue`
    - **Busca de Pacotes e Filtros Rápidos:** Filtra instantaneamente pacotes por nome, código de rastreio (local ou internacional), artista, título do álbum ou nome do lote, além de filtros por status.
    - **Atalho Direto para Correios ("Minhas Importações"):** Ao clicar no código de rastreio internacional, copia o código automaticamente para a área de transferência e abre o portal dos Correios (`#track=...`).
  - **Coluna Direita (Detail — Detalhes do Pacote e Lista de CDs):**
    - **KPIs Globais no Topo:** Total investido em `BRL`, total de álbuns/box sets (e contagem de discos físicos) e média real por CD.
    - **Painel de 4 Cards de Memória de Cálculo:**
      1. **Soma dos CDs (Custo Direto):** Valor original na moeda estrangeira e convertido para `BRL`.
      2. **Custos Indiretos:** Soma de Fretes (Local + Redirecionador + Internacional) e Taxa de Importação (`BRL`).
      3. **Rateio Unitário / CD:** Valor exato de custos indiretos adicionado a cada CD do pacote.
      4. **Total do Pacote:** Custo final consolidado da caixa e média por CD.
    - **Visualização Adaptativa Sem Scroll Horizontal:**
      - **Desktop (`md+`):** Tabela enxuta de 5 colunas (`Capa, Artista & Álbum`, `Valor do CD`, `+ Rateio Unit.`, `Custo Final Real` e `Ações`), com badges compactos de origem de lote e tipo de embalagem (`Jewel Case`, `Somente Encarte`, `Digipack`, `CD Duplo`, `Box Set`) integrados ao título e conversão `Moeda Original → BRL` empilhada.
      - **Mobile:** Cards otimizados com navegação fluida entre lista de pacotes e detalhes.
- **Aba "Todos os CDs da Coleção" (Visão Global):**
  - Consolida todos os CDs importados em uma única tabela comparativa com **busca dedicada exclusivamente por nome do artista ou do álbum**, filtro por status do pacote e ordenação por Artista, Álbum, Menor/Maior Custo Final ou Mais Recentes.

### 2. Cadastro Rápido & Consolidação Inteligente no Redirecionador
- **Identificação Automática de Pacotes e Data Padrão:**
  - O nome do pacote é gerado e atualizado automaticamente em tempo real com base nos artistas/álbuns informados (inclusive quando consolidado), e a data da compra é preenchida automaticamente com a data do dia.
- **Agrupamento de Pacotes Avulsos:** Ao criar ou editar um pacote, o sistema lista todas as compras com status `Comprado` ou `No Redirecionador` disponíveis para consolidação.
- **Seleção Total ou Parcial (Desmembramento):** Permite absorver pacotes inteiros ou selecionar CDs específicos de um lote, transferindo proporcionalmente o frete interno local.
- **Modos de Consolidação com Presets de Taxas:**
  - **Apenas Agrupar (`group_only`):** Mantém as caixas originais (ex: preset padrão `£ 3.00`).
  - **Desempacotar + Agrupar (`unpack_and_repack`):** Retira das embalagens individuais para reduzir peso/volume (ex: preset padrão `£ 6.50`).
- **Reversão Rápida (`Voltar p/ Pacote Único`):** Permite desfazer a consolidação de um pacote inteiro ou extrair um único CD de volta para um pacote avulso com 1 clique.

### 3. Regras de Negócio e Cálculos Automáticos
- **Regra 1 — Custo Indireto Total em BRL:**
  $$\text{Custo Indireto Total (BRL)} = \left(\text{Frete Interno Pacote} + \sum \text{Frete Interno CDs/Bundles} + \text{Taxa Redirecionador} + \text{Frete Internacional}\right) \times \text{Taxa de Câmbio} + \text{Taxa Alfandegária (BRL)}$$
- **Regra 2 — Rateio Unitário por CD:**
  $$\text{Rateio por CD (BRL)} = \frac{\text{Custo Indireto Total (BRL)}}{\text{Quantidade Total de CDs no Pacote}}$$
- **Regra 3 — Custo Final Real de cada CD (e por Disco Físico):**
  $$\text{Custo Final (BRL)} = \left(\text{Valor Unitário Original} \times \text{Taxa de Câmbio}\right) + \text{Rateio por CD (BRL)}$$
  *(Para CDs Duplos ou Box Sets com $N$ discos, exibe também o custo diluído $\text{Custo Final} \div N$).*
- **Regra 4 — Botão Mágico "Estimar MG" (Fator `0,9277`):**
  $$\text{Imposto Estimado MG (BRL)} = \text{Soma dos CDs (BRL)} \times 0,9277$$
  Aplica preventivamente a estimativa de tributação e identifica o valor com a tag `(Est.)` até que o valor definitivo seja lançado.

### 4. Capas Automáticas, Câmbio em Tempo Real, Autenticação e Cloud Sync
- **Autenticação & Isolamento por Usuário (`Clerk`):**
  - Login seguro com conta Google via `@clerk/nextjs`, mantendo coleções, pacotes e `localStorage` isolados por usuário (`userId`).
- **Sincronização Híbrida na Nuvem (`Upstash Redis` / `Vercel KV` + JSON Local):**
  - Sincroniza automaticamente os dados entre **Vercel (Produção)**, **Ambiente Local** (`data/tracker-db.json` e `data/users/<userId>.json`) e **`localStorage`** através da rota `/api/tracker`.
  - Inclui utilitário CLI (`scripts/db-sync.mjs`) para consultar status, baixar (`pull`) ou enviar (`push`) dados diretamente entre o arquivo JSON local e o banco na nuvem Upstash Redis.
  - Exportação e importação manual de backups em formato `.json`.
- **Capas de Álbuns Automáticas (`iTunes Search API` + `MusicBrainz Cover Art Archive`):**
  - Busca automática da arte da capa e ano de lançamento ao cadastrar ou editar álbuns, com algoritmo de pontuação de relevância e seletor rápido para alternar entre edições.
  - Edição rápida (*inline*) de Artista e Álbum diretamente na listagem.
- **Cotação Comercial em Tempo Real:**
  - Integração com `AwesomeAPI` (e fallback para `ExchangeRate-API`) para `GBP`, `USD`, `EUR`, `JPY` e `BRL`.

### 5. Radar Top 100 Demanda & Arbitragem (`Discogs` + `Mercado Livre BR`)
- **Módulo dedicado de inteligência de mercado:** Consulta métricas de demanda real no **Discogs** (*Want*, *Have*, *Índice de Escassez Want/Have* e *Menor Preço Global*) combinadas com anúncios ativos e preços no **Mercado Livre Brasil** para identificar oportunidades de arbitragem e raridades em CD.

---

## 📂 Estrutura do Projeto

```text
├── data/
│   ├── tracker-db.json               # Banco de dados JSON local espelhado
│   └── users/                        # Arquivos JSON isolados por usuário (<userId>.json)
├── scripts/
│   └── db-sync.mjs                   # CLI de sincronização direta entre JSON local e Upstash Redis
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── demand/               # Rotas de API do Radar de Demanda (top100, lookup, mercadolivre)
│   │   │   └── tracker/route.ts      # API Route (GET/POST) autenticada com suporte a Upstash Redis e JSON local
│   │   ├── globals.css               # Estilos globais e importação do Tailwind CSS v4
│   │   ├── layout.tsx                # Root Layout com ClerkProvider (pt-BR, dark mode)
│   │   └── page.tsx                  # Página principal que renderiza o CDImportTrackerApp
│   ├── components/
│   │   ├── AlbumCover.tsx            # Componente de exibição de capa de álbum com fallback visual
│   │   ├── CDImportTrackerApp.tsx    # Componente principal SPA (Dashboard Master/Detail, Coleção Global e Radar)
│   │   ├── CDModal.tsx               # Modal de adição/edição individual ou em lote (Batch) de CDs e capas
│   │   ├── DemandRadarView.tsx       # Módulo Radar Top 100 Demanda & Arbitragem (Discogs + Mercado Livre BR)
│   │   └── ShipmentModal.tsx         # Modal de criação/edição de pacotes, consolidação e lançamento de CDs
│   ├── lib/
│   │   ├── calculations.ts           # Cálculos de rateio, geração automática de nomes, formatação e câmbio
│   │   ├── coverArt.ts               # Integração com iTunes API e MusicBrainz para busca de capas
│   │   ├── discogsDemand.ts          # Integração com Discogs API e cálculo de demanda/escassez
│   │   ├── seedData.ts               # Dados iniciais de exemplo (fallback inicial)
│   │   └── trackerStorage.ts         # Persistência híbrida (Upstash Redis + JSON local por usuário)
│   ├── types/
│   │   ├── demand.ts                 # Interfaces TypeScript do módulo Radar de Demanda
│   │   └── tracker.ts                # Interfaces TypeScript (Shipment, CDItem, ShipmentCalculationSummary, etc.)
│   └── proxy.ts                      # Middleware de autenticação do Clerk (Next.js 16)
├── next.config.ts                    # Configuração do Next.js
├── package.json                      # Dependências e scripts npm
└── tsconfig.json                     # Configuração do TypeScript
```

---

## ⚙️ Variáveis de Ambiente (`.env.local`)

Crie um arquivo `.env.local` na raiz do projeto com as chaves do **Clerk** e, opcionalmente, do **Upstash Redis / Vercel KV** e **Discogs**:

```env
# Autenticação Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Persistência em Nuvem (Upstash Redis / Vercel KV)
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=...

# Token opcional da API do Discogs (Radar de Demanda)
DISCOGS_TOKEN=...
```

---

## 🚀 Como Executar Localmente

### Pré-requisitos
- **Node.js** (v18+ ou v20+ recomendado)
- **npm**

### Passo a Passo

```bash
# 1. Instalar as dependências do projeto
npm install

# 2. Iniciar o servidor de desenvolvimento
npm run dev
```

Acesse **[http://localhost:3000](http://localhost:3000)** no seu navegador.

### Scripts Disponíveis

```bash
# Servidor de desenvolvimento (Webpack)
npm run dev

# Gerar build de produção
npm run build

# Iniciar servidor de produção após o build
npm start

# Verificar regras de lint (ESLint)
npm run lint

# Sincronização de Banco de Dados (Local <-> Upstash Redis Cloud)
npm run db:status   # Exibe o resumo comparativo entre Nuvem (Upstash) e JSON local
npm run db:pull     # Baixa os dados mais recentes da nuvem para data/tracker-db.json
npm run db:push     # Envia os dados de data/tracker-db.json para a nuvem (Upstash)
```
