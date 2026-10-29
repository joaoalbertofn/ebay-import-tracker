# 📋 Lista de Tarefas (TODO) — CD Import Tracker

Este documento reúne as tarefas do projeto organizadas por categoria e status de conclusão.

---

## 🏆 1. Grande Refatoração Arquitetural e Modularização (Concluída)

- [x] **Passo 0: Dependências e Test Runner Automatizado:**
  - Removidas dependências órfãs `framer-motion` e `react-hook-form` de `package.json`.
  - Instalado `vitest@^4.1.12` configurado com `vitest.config.mts` e aliases de caminho `@/*`.
  - Adicionados scripts `npm test` e `npm run test:watch`.
- [x] **Passo 1: Suíte de Baseline Tests de Domínio:**
  - Criado `src/lib/__tests__/calculations.test.ts` cobrindo Regras 1, 2, 3 e 4, rateios de bundles, summaries e formatações financeiras.
- [x] **Passo 2: Domínio Puro & Serviços Isolados:**
  - Criado `src/lib/domain/consolidation.ts` centralizando consolidação simples, multimoeda, descarte com redistribuição e desmembramento (`extractCdToSingleShipment`).
  - Criado `src/lib/__tests__/consolidation.test.ts` com 6 testes unitários garantindo exatidão matemática e retrocompatibilidade.
  - Criado `src/lib/services/exchangeRateService.ts` desacoplando requisições de câmbio de cálculos puros.
  - Criado `src/lib/formatters.ts` (`formatBrl`, `formatOriginalCurrency`, `formatWeightKg`, `formatShortBundleBadge`, `getTodayLocalIsoDate`).
- [x] **Passo 3: Conexão do Domínio nos Componentes:**
  - `ShipmentModal.tsx` e `CDImportTrackerApp.tsx` agora consomem funções puras de `@/lib/domain/consolidation`, eliminando duplicação de regras de negócio.
- [x] **Passo 4: Deduplicação de Código / DRY Hooks:**
  - Criado `src/lib/storage/feePresets.ts` centralizando leitura e gravação no `localStorage`.
  - Criado `src/hooks/useEbayQuickPaste.ts` unificando a integração e feedback de importação do eBay.
- [x] **Passo 5: Desacoplamento da Persistência & Nuvem:**
  - Criado `src/hooks/useTrackerData.ts` encapsulando `shipments`, `cdItems`, hidratação por `userId` do Clerk, reconciliação Nuvem vs Local, auto-save debounced (700ms), revalidação periódica (30min) e integridade de nomes.
  - `CDImportTrackerApp.tsx` liberado de mais de 380 linhas de I/O e persistência.
- [x] **Passo 6: Modularização Visual dos God Components:**
  - Criado `src/components/tracker/ConfirmModal.tsx` (substitui window.confirm).
  - Criado `src/components/tracker/TrackerHeader.tsx` (painel de autenticação, cloud sync e KPIs).
  - Criado `src/components/tracker/GlobalCollectionView.tsx` (aba Minha Coleção completa).
  - Criado `src/components/tracker/PackageSidebar.tsx` (coluna esquerda Master).
  - Criado `src/components/tracker/PackageDetailView.tsx` (coluna direita Detail, tabela e cards responsivos).
  - Decomposto `ShipmentModal.tsx`:
    - Criado `src/components/modals/ForwarderConsolidationSection.tsx`.
    - Criado `src/components/modals/CDEntriesBatchTable.tsx`.
  - `CDImportTrackerApp.tsx` reduzido de quase 4.000 linhas para ~1.200 linhas; `ShipmentModal.tsx` reduzido em mais de 800 linhas.
- [x] **Passo 7: Validação e Robustez Final:**
  - Criado validador estrito `src/lib/validation.ts` e conectado na rota `POST /api/tracker` com cobertura de testes unitários (`src/lib/__tests__/validation.test.ts`).
  - Configurado `images.remotePatterns` no `next.config.ts` cobrindo iTunes, Apple Music, Cover Art Archive, Internet Archive, Discogs e eBay.
  - 100% dos testes unitários passando (`16 passed`) e compilação de produção do Next.js 16 (`next build`) com código 0.

---

## 🛠️ 2. Backlog Técnico e Melhorias Futuras

- [ ] **Externalizar `DEFAULT_USER_ID` do script `scripts/db-sync.mjs`:**
  - Ler o ID exclusivamente de `TRACKER_USER_ID` no `.env.local` e disponibilizar template em `.env.example`.
- [ ] **Refinamento opcional de badges de Tipo de Embalagem:**
  - Permitir customizar badges (`Jewel Case`, `Digipack`, `Somente Encarte`) diretamente no modal de CD.
