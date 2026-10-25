# 📋 Lista de Tarefas Pendentes (TODO) — CD Import Tracker

Este documento reúne as tarefas do projeto organizadas por categoria e status de conclusão.

---

## ✅ 1. Tarefas Concluídas Nesta Iteração

- [x] **Corrigir script `npm run lint` (ESLint v9):**
  - Criado o arquivo `eslint.config.mjs` (Flat Config) compatível com Next.js 16 e TypeScript.
- [x] **Adicionar *debounce* no auto-save da API (`POST /api/tracker`):**
  - Implementado *debounce* de `700ms` nas chamadas ao Upstash Redis / API, mantendo gravação instantânea no `localStorage`.
- [x] **Tratar consolidação entre pacotes de moedas diferentes:**
  - Implementada conversão proporcional automática (`sourceExchangeRate / targetExchangeRate`) para `unitOriginalValue`, `bundleTotalValue`, `bundleInternalShipping`, `unitInternalShipping` e `internalShipping` herdado ao consolidar pacotes de moedas distintas.
- [x] **Permitir editar quantidade de discos (`discCount`) no `ShipmentModal`:**
  - Adicionado input de número de discos físicos (`1 = Simples`, `2 = Duplo`, `3+ = Box Set`) diretamente nas linhas de CD do modal do pacote.
- [x] **Rastreamento de Peso dos Pacotes (`weightKg`):**
  - Adicionado campo de peso em quilogramas (`kg`) nos pacotes, com cálculo de gramas por disco (`~g/disco`) e custo de envio por kg, exibido na lista lateral, nos detalhes do pacote e na visão global da coleção.
- [x] **Exclusão / Descarte de CDs durante a Consolidação de Pacotes (com Redistribuição):**
  - Adicionado botão de descarte (`🗑️`) nos itens disponíveis para consolidação no `ShipmentModal`, redistribuindo automaticamente o valor pago e o frete local dos CDs descartados entre os CDs mantidos daquele lote.
- [x] **Limpar código legado não utilizado:**
  - Removido `LOCKER_SHIPMENT_ID` de `src/types/tracker.ts` e `src/components/CDModal.tsx`.
  - Removidos campos desativados (`postalFeeBrl`, `unpackingFee`, `groupingFee`) e `INITIAL_CD_ITEMS` de `src/lib/seedData.ts`.
  - Alinhado o comentário da fórmula de `estimatedTaxMgBrl` em `src/types/tracker.ts`.
- [x] **Indicador visual de sincronização na nuvem (Cloud Sync Status):**
  - Adicionado badge interativo no cabeçalho (`☁️ Sincronizado`, `⏳ Salvando...` e botão `⚠️ Reenviar Sync`).
- [x] **Opção de personalizar e travar manualmente o nome do pacote (`isCustomName`):**
  - Adicionado campo editável e botão de cadeado (`🔒 Personalizado` / `✨ Automático`) tanto no `ShipmentModal` quanto no título do pacote nos detalhes.
- [x] **Visão Global "Minha Coleção de CDs":**
  - Adicionadas abas no topo do painel alternando entre `📦 Visão por Pacotes` e `💿 Todos os CDs da Coleção`, com busca, filtro por status e ordenação por custo/artista/álbum.
- [x] **Substituir diálogos nativos (`window.confirm` / `alert`) por modais customizados:**
  - Criado modal de confirmação no tema escuro da aplicação e notificações via Toast.

---

## 🛠️ 2. Tarefas Restantes (Backlog Técnico)

- [ ] **Implementar ou atualizar badges de Tipo de Embalagem (`Jewel Case`, `Somente Encarte`, `Digipack`):**
  - O `README.md` menciona tipos de embalagem (`Jewel Case`, `Somente Encarte`, `Digipack`), que podem ser adicionados opcionalmente à interface `CDItem` ou ajustados na documentação.
- [ ] **Remover ou utilizar dependências órfãs no `package.json`:**
  - As bibliotecas `framer-motion` e `react-hook-form` estão listadas em `dependencies`, mas não são importadas no projeto.
- [ ] **Configurar `images.remotePatterns` no `next.config.ts`:**
  - Configurar os domínios de capas (`*.mzstatic.com` do iTunes e `coverartarchive.org`) no `next.config.ts`.
- [ ] **Externalizar `DEFAULT_USER_ID` do script `scripts/db-sync.mjs`:**
  - Ler o ID exclusivamente de `TRACKER_USER_ID` no `.env.local` e criar um `.env.example`.
- [ ] **Validar schema do payload na API (`/api/tracker`) e criar testes unitários para `src/lib/calculations.ts`:**
  - Adicionar validação estrutural dos arrays `shipments` e `cdItems` e suíte de testes automatizados para as regras de cálculo e rateio.
