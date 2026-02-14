# DEPLOY.md - Vercel + Railway + Testnet 배포 가이드

이 문서는 Tickasting를 아래 구조로 배포하는 기준 문서입니다.

- FE: Vercel (`apps/web`)
- BE API: Railway (`apps/api`)
- Indexing: Railway (`apps/ponder` — target; `apps/indexer` is deprecated)
- DB: Railway PostgreSQL (single source of truth)
- Contract: Sepolia EVM testnet (`contracts/`)
- Chain: Kaspa testnet (데모/검증 기준)

---

## 0) 배포 아키텍처

> **아키텍처 결정 (GP-027):** 인덱싱은 Ponder(`apps/ponder`)로 전환한다.
> `apps/indexer`는 deprecated이며 전환 완료(GP-035) 후 제거한다.
> 상세: `docs/architecture.md`

### 0.1 서비스 구성 (목표)

| # | Service | Platform | Visibility |
|---|---------|----------|------------|
| 1 | `tickasting-web` | Vercel | Public |
| 2 | `tickasting-api` | Railway | Public |
| 3 | `tickasting-ponder` | Railway | Private (target indexer) |
| 4 | `tickasting-postgres` | Railway | Internal |
| 5 | ~~`tickasting-indexer`~~ | ~~Railway~~ | ~~Private (deprecated)~~ |

### 0.2 데이터 흐름

1. 브라우저 → Vercel Web App 접속
2. Web → Railway API(`https://...up.railway.app`) 호출
3. Ponder Worker → Kaspa testnet / EVM Sepolia에서 tx/이벤트 인덱싱
4. Ponder → Railway Postgres에 인덱싱 결과 적재
5. API → Postgres에서 도메인 로직/집계 수행

---

## 1) 사전 체크리스트

- Node.js 20+
- pnpm 9+
- Railway 프로젝트 생성 완료
- Vercel 프로젝트 생성 완료
- Kaspa testnet 지갑/treasury 주소 준비

컨트랙트:
- 클레임 컨트랙트는 EVM Testnet (Sepolia)에 배포합니다.
- 상세 스펙: `docs/contract-spec.md`
- 컨트랙트 없이도 Kaspa 결제/순번/결과 플로우는 동작합니다 (claim만 비활성).

---

## 2) Railway 설정

## 2.1 프로젝트/서비스 생성

Railway 한 프로젝트에 아래를 만듭니다.

1. `tickasting-api` 서비스 (Public Domain)
2. `tickasting-ponder` 서비스 (Private, 내부 헬스체크만)
3. PostgreSQL 서비스
4. (전환 완료 전) `tickasting-indexer` 서비스 (deprecated, Private)

권장:
- `tickasting-ponder`는 Public Domain을 열지 않고 내부 헬스체크만 사용

## 2.2 Monorepo 배포 원칙

이 레포는 workspace(`packages/shared`) 의존이 있으므로, 서비스별로 디렉토리를 잘라 배포하지 말고 **레포 루트 기준**으로 배포하세요.

## 2.3 API 서비스 명령어

- Build Command:

```bash
pnpm --filter @tickasting/api db:generate && pnpm --filter @tickasting/shared build && pnpm --filter @tickasting/api build
```

- Start Command:

```bash
API_HOST=0.0.0.0 API_PORT=${PORT:-4001} pnpm --filter @tickasting/api start
```

## 2.4 Ponder 서비스 명령어 (target)

> 정확한 빌드/시작 명령은 GP-028에서 확정한다. 아래는 예상 구조다.

- Build Command:

```bash
pnpm --filter @tickasting/ponder build
```

- Start Command:

```bash
pnpm --filter @tickasting/ponder start
```

## 2.4.1 Indexer 서비스 명령어 (deprecated)

> `apps/indexer`는 deprecated다. Ponder 전환 완료(GP-035) 후 제거 예정.

- Build Command:

```bash
pnpm --filter @tickasting/indexer db:generate && pnpm --filter @tickasting/shared build && pnpm --filter @tickasting/indexer build
```

- Start Command:

```bash
INDEXER_PORT=${PORT:-4002} pnpm --filter @tickasting/indexer start
```

## 2.5 API 환경변수 (`tickasting-api`)

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `API_HOST=0.0.0.0`
- `KASPA_NETWORK=testnet`

권장:

- `WS_BROADCAST_INTERVAL_MS=2000`
- `KASFYI_API_KEY=<optional>`
- `TICKET_SECRET=<랜덤 긴 문자열>`

## 2.6 Indexer 환경변수 (`tickasting-indexer`)

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `KASPA_NETWORK=testnet`

권장:

- `INDEXER_POLL_INTERVAL_MS=5000`
- `KASFYI_API_KEY=<optional>`

## 2.7 DB 스키마 반영 (초기 1회)

이 레포에는 `prisma/migrations` 디렉토리가 없으므로, 초기 배포 시 `db push`로 스키마를 맞춥니다.

Railway 서비스 셸(또는 Job)에서 1회 실행:

```bash
pnpm --filter @tickasting/api db:generate
pnpm --filter @tickasting/api db:push
```

필요 시 시드:

```bash
pnpm --filter @tickasting/api db:seed
```

---

## 3) Vercel 설정 (`apps/web`)

## 3.1 프로젝트 연결

- Framework: Next.js
- Root Directory: `apps/web`

## 3.2 Vercel 환경변수

필수:

- `NEXT_PUBLIC_API_URL=https://<tickasting-api-public-domain>`
- `NEXT_PUBLIC_WS_URL=wss://<tickasting-api-public-domain>`

예시:

- `NEXT_PUBLIC_API_URL=https://tickasting-api-production.up.railway.app`
- `NEXT_PUBLIC_WS_URL=wss://tickasting-api-production.up.railway.app`

주의:
- `NEXT_PUBLIC_*` 값은 빌드 시점에 주입됩니다.
- 값 변경 후에는 Vercel에서 반드시 재배포가 필요합니다.

---

## 4) Testnet(온체인) 준비

데모에서 반드시 맞춰야 하는 값:

1. 세일 생성 시 `network: "testnet"`
2. `treasuryAddress`는 testnet 주소
3. 지갑(KasWare)도 testnet 네트워크
4. Indexer 환경변수 `KASPA_NETWORK=testnet`

---

## 5) 배포 후 스모크 테스트

## 5.1 API/Indexer 헬스체크

```bash
curl https://<tickasting-api-public-domain>/health
curl https://<tickasting-indexer-private-or-public-domain>/health
```

Indexer를 private로 두면 Railway 내부 헬스체크나 로그로 확인하세요.

## 5.2 E2E 테스트 (데모 전 필수)

1) 이벤트 생성

```bash
curl -X POST https://<tickasting-api-public-domain>/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Railway+Vercel Demo","venue":"Online"}'
```

2) 세일 생성 (`eventId` 교체)

```bash
curl -X POST https://<tickasting-api-public-domain>/v1/events/<eventId>/sales \
  -H "Content-Type: application/json" \
  -d '{
    "network":"testnet",
    "treasuryAddress":"kaspa:<YOUR_TESTNET_TREASURY_ADDRESS>",
    "ticketPriceSompi":"100000000",
    "supplyTotal":10,
    "powDifficulty":8
  }'
```

3) 세일 publish

```bash
curl -X POST https://<tickasting-api-public-domain>/v1/sales/<saleId>/publish
```

4) 브라우저 확인

- `https://<your-vercel-domain>/sales/<saleId>`
- `https://<your-vercel-domain>/sales/<saleId>/live`
- `https://<your-vercel-domain>/sales/<saleId>/results`

---

## 6) 데모 당일 체크리스트

1. Railway API/Indexer 상태 Green
2. Railway Postgres 연결 정상
3. Vercel 최신 배포가 `Ready`
4. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`가 Railway API 도메인으로 설정됨
5. sale의 `network=testnet`
6. 지갑 네트워크 testnet

---

## 7) 장애 대응 빠른 가이드

## 7.1 Web에서 API 호출 실패

- Vercel env의 `NEXT_PUBLIC_API_URL` 확인
- API Public Domain이 살아있는지 `curl /health` 확인

## 7.2 live 페이지 WebSocket 미수신

- `NEXT_PUBLIC_WS_URL`가 `wss://...railway.app`인지 확인
- API 로그에서 `/ws/sales/:saleId` 연결 로그 확인

## 7.3 Indexer가 구매 감지 못함

- Indexer env `KASPA_NETWORK=testnet` 확인
- sale이 `live` 상태인지 확인
- `treasuryAddress`가 testnet 주소인지 확인
- `KASFYI_API_KEY` 추가 후 재시도

---

## 8) Contract 배포 (Sepolia)

### 8.1 사전 준비

- Sepolia ETH (faucet: https://sepoliafaucet.com)
- Infura/Alchemy Sepolia RPC URL
- 배포자 private key

### 8.2 환경변수

`contracts/.env` (커밋 금지):

```dotenv
CONTRACT_RPC_URL=https://sepolia.infura.io/v3/<your-key>
DEPLOYER_PRIVATE_KEY=<deployer-private-key>
ETHERSCAN_API_KEY=<optional-for-verify>
```

### 8.3 배포 절차

```bash
# 1. 컴파일
pnpm --filter @tickasting/contracts compile

# 2. 테스트
pnpm --filter @tickasting/contracts test

# 3. Sepolia 배포
pnpm --filter @tickasting/contracts deploy:sepolia

# 4. 출력된 컨트랙트 주소를 기록
# TICKASTING_CONTRACT_ADDRESS=0x...

# 5. (선택) Etherscan 검증
pnpm --filter @tickasting/contracts verify -- <contract-address>

# 6. ABI export
pnpm --filter @tickasting/contracts export-abi
```

### 8.4 컨트랙트 초기화

배포 후 컨트랙트에 sale/ticketType을 등록합니다:

1. `createSale(saleId, organizerAddress, startAt, endAt)`
2. `defineTicketType(typeCode, name, priceSompi, supply, metadataUri)` — 타입별 반복
3. 판매 종료 + 결과 확정 후: `openClaim(merkleRoot)`
4. 모든 claim 완료 후: `finalizeSale()`

### 8.5 API에 컨트랙트 주소 등록

```bash
curl -X PATCH https://<api-domain>/v1/sales/<saleId>/contract \
  -H "Content-Type: application/json" \
  -d '{"claimContractAddress":"0x<deployed-address>"}'
```

---

## 9) 데모 체크리스트 (컨트랙트 포함)

1. Railway API/Indexer 상태 Green
2. Railway Postgres 연결 정상
3. Vercel 최신 배포 Ready
4. Sepolia 컨트랙트 배포 완료 + 주소 등록
5. sale에 ticket types 등록 (VIP/R/GEN)
6. `network=testnet`, 지갑 testnet
7. claim 스모크 테스트: 1건 claim → tokenId 확인

---

## 10) 업데이트 배포 루틴

1. 코드 머지
2. Railway API/Indexer 자동 재배포 확인
3. 필요 시 API 서비스에서 `pnpm --filter @tickasting/api db:push`
4. 컨트랙트 변경 시: 재배포 + ABI export + 주소 갱신
5. Vercel 재배포
6. 스모크 테스트 1회 재실행
