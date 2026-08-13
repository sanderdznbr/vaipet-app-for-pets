# Tieck App

## Infraestrutura
- **Backend:** Supabase (projeto `txqfdscdlltohpkkznwa`).
- **Deploy:** Vercel.
- **Gerenciador de Pacotes:** `npm` (mantenha `package-lock.json` como único lockfile).
- **Ambiente:** Node 22+.

## Camera AI
- **Estado:** Baseline neutra e desativada.
- **Endpoint:** `/api/camera-ai/verify`.
- **Comportamento:** Retorna 503 quando desativado, 501 quando não implementado.

## Desenvolvimento
- **Instalação:** `npm ci`
- **Build:** `npm run build`
- **Testes de Rotas:** `npm run test:routes`
- **Testes Camera AI:** `npm run test:camera-ai`
