# Tieck App - Camera AI Baseline

Este repositório contém a baseline neutra para o sistema Camera AI.

## Estado Atual: Baseline Neutra
- **Upload Fotográfico:** Funcional e neutro.
- **Endpoint de IA:** O endpoint `/api/camera-ai/verify` está em modo neutro e previsível.
- **Implementação OpenAI:** Ainda não iniciada (Fase 1 pendente).
- **Modo de Operação:** `CAMERA_AI_MODE` deve permanecer como `disabled`.

## Arquitetura
- O upload de evidências é puramente fotográfico.
- Motores legados de IA foram arquivados em `archive/camera-ai-legacy/`.
- A próxima fase integrará a OpenAI Responses API com o modelo `gpt-4o-mini`.

## Desenvolvimento
- **NPM:** Use exclusivamente `npm` (não use `bun`).
- **Testes:** `npm run test:routes` verifica a neutralidade do endpoint.
