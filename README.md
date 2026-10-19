# 💿 CD Import Tracker

Aplicação web **Single Page Application (SPA)** desenvolvida com **Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4** para gerenciar a compra e importação de CDs e Box Sets no exterior (eBay UK, EUA, Europa, Japão), consolidação de pacotes em redirecionadores de encomendas e cálculo automático do rateio de fretes e impostos alfandegários em Reais (`BRL`).

---

## ✨ Funcionalidades Principais

### 1. Arquitetura Master / Detail Responsiva (Desktop & Mobile)
- **Coluna Esquerda (Master — Lista de Pacotes):**
  - Exibe todos os pacotes/lotes cadastrados com **Nome**, **Badge de Status**, **Modo de Consolidação**, **Quantidade de CDs** e **Custo Total em BRL**.
  - **6 Status do Fluxo de Importação:**
    - `🛒 Comprado (Pacote Único)`
    - `📍 No Redirecionador (Avulso)`
    - `📦 Já Consolidado (No Redirecionador)`
    - `✈️ Em Trânsito`
    - `🧾 Tributado (Receita/MG)`
    - `✅ Entregue`
  - **Busca Global e Filtros Rápidos:** Filtra instantaneamente pacotes por nome, código de rastreio (local ou internacional), artista, título do álbum ou nome do lote, além de filtros por status.
- **Coluna Direita (Detail — Detalhes do Pacote e Lista de CDs):**
  - **KPIs Globais no Topo:** Total investido em `BRL`, total de álbuns/box sets (e contagem de discos físicos) e média real por CD.
  - **Painel de 4 Cards de Memória de Cálculo:**
    1. **Soma dos CDs (Custo Direto):** Valor original na moeda estrangeira e convertido para `BRL`.
    2. **Custos Indiretos:** Soma de Fretes (Local + Redirecionador + Internacional) e Taxa de Importação (`BRL`).
    3. **Rateio Unitário / CD:** Valor exato de custos indiretos adicionado a cada CD do pacote.
    4. **Total do Pacote:** Custo final consolidado da caixa e média por CD.
  - **Visualização Adaptativa:** Tabela completa no Desktop e Cards otimizados sem rolagem horizontal no Mobile (com navegação nativa entre lista e detalhes).

### 2. Consolidação Inteligente no Redirecionador
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

### 4. Busca Automática de Capas, Câmbio em Tempo Real e Persistência Híbrida
- **Capas de Álbuns Automáticas (`iTunes Search API` + `MusicBrainz Cover Art Archive`):**
  - Busca automática da arte da capa e ano de lançamento ao cadastrar ou editar álbuns, com algoritmo de pontuação de relevância e seletor rápido para alternar entre edições.
  - Edição rápida (*inline*) de Artista e Álbum diretamente na listagem.
- **Cotação Comercial em Tempo Real:**
  - Integração com `AwesomeAPI` (e fallback para `ExchangeRate-API`) para `GBP`, `USD`, `EUR`, `JPY` e `BRL`.
- **Persistência Dupla (`LocalStorage` + API Local JSON) & Backup:**
  - Sincroniza automaticamente os dados no navegador (`localStorage`) e no arquivo local `data/tracker-db.json` via rota `/api/tracker`, permitindo acesso compartilhado na rede local (Desktop e Mobile).
  - Exportação e importação manual de backups em formato `.json`.

---

## 📂 Estrutura do Projeto

```text
├── data/
│   └── tracker-db.json               # Banco de dados JSON local sincronizado via API
├── src/
│   ├── app/
│   │   ├── api/tracker/route.ts      # API Route (GET/POST) para leitura/gravação em data/tracker-db.json
│   │   ├── globals.css               # Estilos globais e importação do Tailwind CSS v4
│   │   ├── layout.tsx                # Root Layout (pt-BR, dark mode)
│   │   └── page.tsx                  # Página principal que renderiza o CDImportTrackerApp
│   ├── components/
│   │   ├── CDImportTrackerApp.tsx    # Componente principal SPA (Dashboard Master/Detail, estado e ações)
│   │   ├── ShipmentModal.tsx         # Modal de criação/edição de pacotes, consolidação e lançamento rápido de CDs
│   │   └── CDModal.tsx               # Modal de adição/edição individual ou em lote (Batch) de CDs e capas
│   ├── lib/
│   │   ├── calculations.ts           # Funções de cálculo de rateio, formatação de moedas e cotação ao vivo
│   │   ├── coverArt.ts               # Integração com iTunes API e MusicBrainz para busca de capas
│   │   └── seedData.ts               # Dados iniciais de exemplo (fallback inicial)
│   └── types/
│       └── tracker.ts                # Interfaces TypeScript (Shipment, CDItem, ShipmentCalculationSummary, etc.)
├── next.config.ts                    # Configuração do Next.js
├── package.json                      # Dependências e scripts npm
└── tsconfig.json                     # Configuração do TypeScript
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

### Outros Scripts Disponíveis

```bash
# Gerar build de produção
npm run build

# Iniciar servidor de produção após o build
npm start

# Verificar regras de lint (ESLint)
npm run lint
```
