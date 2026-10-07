# Oficina - Execução e Produção

[![CI/CD](https://github.com/Williamnasci/oficina-execution-service/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Williamnasci/oficina-execution-service/actions/workflows/ci-cd.yml)

Microsserviço da Fase 4 do Tech Challenge FIAP. Diagnóstico, fila paga, início/finalização do reparo e cancelamento com tombstone. Banco exclusivo: **MongoDB**.

## Serviços e fronteiras

- [OS Service](https://github.com/Williamnasci/oficina-os-service): cliente/veículo, ciclo da OS e coordenação da Saga.
- [Billing Service](https://github.com/Williamnasci/oficina-billing-service): orçamento e transações financeiras.
- [Execution Service](https://github.com/Williamnasci/oficina-execution-service): operação técnica.

Nenhum serviço acessa o banco de outro. O runtime depende apenas dos arquivos deste repositório e de seu próprio banco/broker, sem imports de código dos outros serviços.

## Arquitetura

NestJS/Express, TypeScript para regras de domínio, adapters ESM para HTTP, persistência e mensageria. Os métodos do serviço retornam decisões de estado/eventos; uma transação local grava agregado, inbox e outbox. O consumidor só confirma após commit. O relay só marca a outbox após publisher confirm. Delivery é at-least-once e exige deduplicação.

PostgreSQL usa transação e lock por agregado. MongoDB usa compare-and-swap de versão com estado, inbox e outbox no mesmo documento; esse modelo não exige transação entre documentos. Array de inbox/outbox deve ter retenção/arquivamento antes de escala de produção para respeitar limite de documento.

## Por que Saga orquestrada

O OS Service coordena comandos RabbitMQ e aguarda eventos de cada participante. A escolha permite visualizar a sequência com aprovação humana, pagamento externo, deadlines e compensação no mesmo lugar, sem acesso aos bancos participantes. O custo é manter o coordenador disponível; seu estado e comandos são persistidos para retomada.

Fluxo: abertura -> diagnóstico -> orçamento -> aprovação -> pagamento verificado -> fila -> reparo -> finalização -> entrega. Falha antes do reparo cancela execução e reservas existentes primeiro, depois cancela cobrança ou confirma reembolso. Apenas depois de `BillingCompensated` a Saga fica `COMPENSATED`. Falha de compensação ou reparo físico já iniciado exige `MANUAL_INTERVENTION`.

## Executar e verificar

Node.js 24.9 ou superior da série 24:

```sh
npm ci
npm run build
npm run quality
npm run test:cov
npm start
```

Configurar DATABASE_URL, AMQP_URL e JWT_SECRET (mínimo 32 caracteres). API na porta PORT (padrão 3000). Swagger em `/docs`, contrato em [openapi.json](openapi.json), métricas em `/metrics`, liveness em `/health`, readiness em `/ready`.

Autenticação HS256 compatível com o segredo do emissor da Fase 3. Cliente só consulta/decide seu orçamento/OS; operadores/admins executam ações operacionais. Cadastro completo e adaptação do login CPF da Fase 3 ainda precisam de migração controlada antes do corte da API antiga.

## Qualidade e evidências

15 testes de domínio, serviço e adapters; cobertura de linhas/branches/funções/statements com gate >=80%. Análise estática bloqueante via ESLint + regras SonarJS, além de TypeScript strict. Adapters HTTP/banco/broker estão incluídos na cobertura; apenas o ponto de composição `src/main.mjs` é excluído e exercitado pelos containers/BDD.

Relatórios LCOV são gerados em `coverage/lcov.info` e publicados como artifacts no [CI](https://github.com/Williamnasci/oficina-execution-service/actions). Não declarar execução de SonarQube Cloud: a alternativa adotada é SonarJS/ESLint. `sonar-project.properties` prepara integração futura com SonarQube.

`TEST_DATABASE_URL` habilita `npm run test:integration` em base dedicada; testa concorrência, inbox, outbox, aborto e persistência após reconexão. A base não deve ser a mesma da API ativa, pois o relay consumiria os eventos do teste.

## CI/CD e infraestrutura própria

[Pipeline](.github/workflows/ci-cd.yml): build, análise estática, coverage, integração, imagem GHCR por SHA e deploy automático em Kubernetes temporário com Kind v0.33.0, rollout/readiness/OpenAPI, sem credencial de nuvem. [Dockerfile](Dockerfile) executa como usuário sem privilégios. [Manifestos](k8s/base) incluem namespace próprio, aplicação, banco com PVC e NetworkPolicy. Há também job de deploy remoto configurável.

Deploy remoto requer `KUBE_CONFIG` no environment `fase4`, Secrets `service-secrets` no namespace e `DEPLOY_ENABLED=true`. Sem essas configurações o job é explicitamente desabilitado, não uma evidência de deploy remoto. Preparar acesso ao pacote GHCR se ele estiver privado. NetworkPolicy só é efetiva em CNI que a implemente; o Kindnet local não é evidência de enforcement.

## Limites desta implementação

Dados da Fase 3 ainda não foram migrados. Estoque/reservas, revisão de orçamento e CRUD legado ainda precisam ser extraídos. Não substituir a API antiga sem backfill e testes de regressão. O orçamento admite serviços do catálogo próprio de Billing (preço canônico substitui valores do solicitante) e linhas manuais de diagnóstico informadas por operador autorizado. Os valores são congelados no orçamento.
