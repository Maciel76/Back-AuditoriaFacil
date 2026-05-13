# Novo sistema de auditoriaAuditoria
Sistema multi-tenant para gestão de **auditorias de loja** (Etiqueta, Presença e Ruptura) com cálculo automático de conformidade, pontuação, ranking de colaboradores/lojas, gamificação e dashboards.

> **Stack**: Node.js 22 · Express 5 · MongoDB · Mongoose 8 · Vue 3.5 · Vite 7 · Pinia · Chart.js · FontAwesome  
> **Design**:deve ter um tema claro tambem  tema dark moderno com gradientes (`#7c5cff → #22d3ee`), glassmorphism nos KPIs, badges por tipo, avatares com iniciais. 

---

## ✨ Funcionalidades

- **Detecção automática do tipo de auditoria** (Etiqueta / Presença / Ruptura) pelo dia da semana deve ajusta para a detecção automática do tipo de auditoria pelo pelo dia da semana (segunda/quinta = Etiqueta, terça = Presença, quarta = Ruptura), mas também deve permitir override manual no upload. ao seleciona o tipo
- **Importação XLSX/XLSM/XLSB/XLS/CSV/ODS** via upload (até 100MB), com chunking e idempotência (re-uploads do mesmo dia substituem dados anteriores). do tipo selecionado ou detectado. por exemplo se for segunda e nesse dia eu resolvo manda uma de presença manualmente o sistema deve aceitar e processar como auditoria de presença, de um dia separado.
- **Multi-tenant** por loja: cada usuário enxerga apenas dados da sua loja; super admin enxerga tudo.
- **3 perfis**: `SUPER_ADMIN`, `STORE_ADMIN`, `COLABORADOR`.
- **Cálculo de conformidade, pontuação, custo de ruptura** por auditoria, por loja, por colaborador e por dia.
- **Ranking** de colaboradores e lojas (filtros por período e tipo).
- **Gamificação**: níveis (1 + ⌊pontos/500⌋), conquistas (`PRIMEIRA_AUDITORIA`, `CEM_LIDOS`, `MIL_LIDOS`, `DEZ_MIL_LIDOS`, `CONFORMIDADE_95`, `NIVEL_5`).
- **Dashboards** com KPIs, gráficos de linha, doughnut e barras.
- **Relatórios** por situação e por setor.
- **Página de perfil do colaborador** com histórico, conquistas e gráficos.

---



> Sem MongoDB instalado? Crie um cluster grátis em https://www.mongodb.com/atlas e use a connection string no `.env`. esta criado so que po front end agora nao esta impotando os dados 

---

## 🚀 Setup

### Backend
```bash
cd backend
npm install
cp .env.example .env   # ajuste MONGO_URI e JWT_SECRET se quiser
npm run dev            # http://localhost:4000
```

Na primeira execução, o servidor cria um **super admin** padrão:
```
email:  admin@novaauditoria.local
senha:  admin123
```
> Troque a senha imediatamente em produção.

### Frontend
```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_BASE=http://localhost:4000/api
npm run dev            # http://localhost:5173
```

### Build de produção
```bash
cd frontend && npm run build   # gera dist/
cd backend  && npm start
```

---

## 🗂 Estrutura

```
novaauditoria/
├── backend/
│   ├── src/
│   │   ├── config/        # env, conexão Mongo
│   │   ├── models/        # Loja, Usuario, Colaborador, Auditoria, AuditItem, MetricaDiaria
│   │   ├── middlewares/   # auth, tenant scoping, upload
│   │   ├── services/      # planilhaParser, regras, auditoriaProcessor
│   │   ├── routes/        # auth, lojas, usuarios, colaboradores, auditorias, metricas
│   │   ├── utils/         # jwt, http
│   │   └── server.js
│   └── scripts/testParser.mjs   # teste local do parser sem Mongo
└── frontend/
    └── src/
        ├── styles/global.css
        ├── components/    # KpiCard, AppChart, Loader, PeriodoSelector
        ├── views/         # Dashboard, Auditorias, AuditoriaDetalhe, Rankings,
        │                  # Colaboradores, ColaboradorPerfil, Relatorios,
        │                  # Configuracoes, AdminLojas, Login
        ├── layouts/AppLayout.vue
        ├── stores/        # auth, ui
        ├── services/api.js
        ├── router.js
        └── main.js
```

---

## 📊 Tipos de auditoria e regras

### Etiqueta
| Situação | Conforme | Pontos |
|---|---|---|
| Atualizado | ✅ | +1 |
| Desatualizado | ❌ | -1 |
| Lido sem estoque | ✅ | +0.2 |
| Lido não pertence | ❌ | -0.2 |
| Não lidos com estoque | — | 0 (não conta) |
| Sem Estoque | — | 0 (não conta) |

### Presença
| Situação | Conforme | Pontos |
|---|---|---|
| Com Presença e com Estoque | ✅ | +1 |
| Sem Presença e Com Estoque | ❌ | -1 |
| Com Presença e sem Estoque | ✅ | +0.3 |
| Sem Presença e Sem Estoque | — | 0 |
| Lido não pertence | ❌ | -0.2 |

### Ruptura
| Situação | Conforme | Pontos |
|---|---|---|
| Sem Presença e Com Estoque | ❌ (crítico) | **-2** |
| Com Presença e com Estoque | ✅ | +1 |
| Com Presença e sem Estoque | ✅ | +0.3 |
| Sem Presença e Sem Estoque | — | 0 |
| Lido não pertence | ❌ | -0.2 |

---

## 🔌 Principais rotas da API

```
POST   /api/auth/register-loja        cria loja + admin da loja
POST   /api/auth/login                JWT
GET    /api/auth/me

GET    /api/lojas                     (super admin)
POST   /api/lojas
PATCH  /api/lojas/:id
GET    /api/lojas/me

GET    /api/usuarios
POST   /api/usuarios
PATCH  /api/usuarios/:id
DELETE /api/usuarios/:id

GET    /api/colaboradores
POST   /api/colaboradores
PATCH  /api/colaboradores/:id
POST   /api/colaboradores/:id/usuario   vincula login

GET    /api/auditorias/regras
POST   /api/auditorias/upload         multipart: arquivo (xlsx/csv) + tipo? (override)
GET    /api/auditorias?tipo=&dataInicio=&dataFim=
GET    /api/auditorias/:id
GET    /api/auditorias/:id/itens?situacao=&conforme=&q=&page=&limit=
DELETE /api/auditorias/:id

GET    /api/metricas/dashboard?periodo=7d|30d|90d|mes|ano
GET    /api/metricas/ranking/colaboradores
GET    /api/metricas/ranking/lojas
GET    /api/metricas/colaboradores/:id/perfil
GET    /api/metricas/relatorios/situacoes
GET    /api/metricas/relatorios/setores
```

---

## 🧪 Validação do parser (sem MongoDB)

Coloque planilhas reais na raiz do projeto e rode:
```bash
cd backend
node scripts/testParser.mjs
```

Resultado esperado (com as planilhas de exemplo):
```
== Etiqueta 08-04.xlsx
  tipo: ETIQUETA | data: 2025-08-04 | linhas: 13818
  conformidade: 93.35%
== Presença 08-05.xlsx
  tipo: PRESENCA | data: 2025-08-05 | linhas: 13727
  conformidade: 91.32%
== Ruptura 08-06.xlsx
  tipo: RUPTURA  | data: 2025-08-06 | linhas: 491
  conformidade: 66.81%
```

---

## 🎨 Design system

- **Cores**: `--bg-0:#0b0f1a`, `--primary:#7c5cff`, `--accent:#22d3ee`
- **Tipografia**: Inter / system-ui
- **Componentes**: cards com `backdrop-filter`, KPIs com overlay gradiente, badges por tipo, avatar circular gradiente, dropzone para upload.
- Layout sidebar fixa 260px + topbar com badge do dia da semana sugerindo o tipo (Seg/Qui = Etiqueta, Ter = Presença, Qua = Ruptura).

---

## 🔐 Segurança

- Senhas com `bcryptjs` (10 rounds).
- JWT com `JWT_SECRET` configurável.
- `helmet`, `cors` allowlist, `express-rate-limit` (300 req/min).
- Multi-tenant enforced no middleware `escopoLoja`.
- Validação de payloads com `zod`.

---

## 📝 Licença

Projeto privado / interno.
