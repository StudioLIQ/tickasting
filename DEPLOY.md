# DEPLOY.md

인턴 온보딩용 배포 가이드입니다.  
현재 기준은 **Kasplex testnet EVM 단일 경로**입니다.

- 구매 선착순 결정: EVM `USDC Transfer` 온체인 순서
- Claim/NFT: TickastingSale 컨트랙트 이벤트

---

## 0) 최종 아키텍처 / 도메인

- `apps/web` -> Vercel (Public)
- `apps/api` -> Railway (Public)
- `apps/ponder` -> Railway (Private)
- PostgreSQL -> Railway (Private/Internal)

운영 도메인:

- Web: `https://tickasting.studioliq.com`
- API: `https://api-tickasting.studioliq.com`

핵심:

1. 사용자가 USDC를 treasury EVM 주소로 전송
2. Ponder가 `PaymentToken.Transfer` 이벤트 인덱싱
3. API가 온체인 블록/로그 순서로 랭킹 계산
4. winner가 컨트랙트에서 claim

---

## 1) 사전 준비

필수 계정:

- GitHub
- Railway
- Vercel

필수 값:

- `PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54`
- Kasplex RPC: `https://rpc.kasplextest.xyz`
- 컨트랙트 주소 `TICKASTING_CONTRACT_ADDRESS` (배포 후 입력)
- treasury EVM 주소(세일 생성 시 사용)

---

## 2) Railway 프로젝트 생성

1. Railway `New Project` -> `Deploy from GitHub Repo`
2. 현재 레포 연결
3. PostgreSQL 추가 (`tickasting-postgres` 권장)
4. 같은 프로젝트 안에 서비스 2개 생성:
   - `tickasting-api`
   - `tickasting-ponder`

---

## 3) API 서비스 배포 (`tickasting-api`)

### 3-1. 서비스 생성

1. `New` -> GitHub Repo -> 같은 레포
2. 서비스 이름: `tickasting-api`

### 3-2. Build/Start

Build:

```bash
pnpm --filter @tickasting/api db:generate \
  && pnpm --filter @tickasting/shared build \
  && pnpm --filter @tickasting/api build
```

Start:

```bash
API_HOST=0.0.0.0 API_PORT=${PORT:-4001} pnpm --filter @tickasting/api start
```

Railway 설정:

- Root Directory: 저장소 루트 (`.`)
- Healthcheck Path: `/health`
- Public Networking: ON
- Custom Domain: `api-tickasting.studioliq.com`

### 3-3. Variables

빠른 적용(권장):

- `deploy/env/railway-api.env` 파일 내용을 Railway `Variables`의 **Raw Editor**에 한 번에 붙여넣기
- `DATABASE_URL`는 Railway Postgres reference 변수로 설정 권장 (`${{Postgres.DATABASE_URL}}`)

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `API_HOST=0.0.0.0`
- `TICKET_SECRET=<랜덤 긴 문자열>`
- `PURCHASE_MODE=evm`
- `USE_PONDER_DATA=true`
- `PONDER_SCHEMA=public`
- `PONDER_RPC_URL_167012=https://rpc.kasplextest.xyz`
- `CONTRACT_RPC_URL=https://rpc.kasplextest.xyz`

권장:

- `WS_BROADCAST_INTERVAL_MS=2000`

선택:

- `API_PORT=${PORT}` (보통 Start 커맨드에서 처리하므로 생략 가능)

---

## 4) Ponder 서비스 배포 (`tickasting-ponder`)

### 4-1. 서비스 생성

1. `New` -> GitHub Repo -> 같은 레포
2. 서비스 이름: `tickasting-ponder`

### 4-2. Build/Start

Build:

```bash
pnpm --filter @tickasting/ponder typecheck
```

Start:

```bash
pnpm --filter @tickasting/ponder start
```

Railway 설정:

- Root Directory: 저장소 루트 (`.`)
- Healthcheck Path: `/health` (또는 `/ready`)
- Public Networking: OFF (권장, 내부 운영)

### 4-3. Variables

빠른 적용(권장):

- `deploy/env/railway-ponder.env` 파일 내용을 Railway `Variables`의 **Raw Editor**에 한 번에 붙여넣기
- `DATABASE_URL`는 Railway Postgres reference 변수로 설정 권장 (`${{Postgres.DATABASE_URL}}`)

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `PONDER_RPC_URL_167012=https://rpc.kasplextest.xyz`
- `PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54`
- `USDC_TRANSFER_START_BLOCK=0` (또는 운영 시작 블록)
- `TICKASTING_CONTRACT_ADDRESS=0x<deployed-contract-address>`
- `TICKASTING_START_BLOCK=<deploy-block>`

---

## 5) DB 초기화

`tickasting-api` 서비스 Shell 또는 Railway Job에서 1회 실행:

```bash
pnpm --filter @tickasting/api db:generate
pnpm --filter @tickasting/api exec prisma migrate deploy
```

샘플 데이터 필요 시:

```bash
pnpm --filter @tickasting/api db:seed
```

참고:

- 현재 시드는 실제 콘서트 스타일 데이터(이벤트/세일/좌석/이미지/지갑 다수)로 구성됩니다.
- 테스트넷 정책에 맞춰 티켓 가격은 전부 `0.1 ~ 0.5 USDC` 범위입니다.

---

## 6) Vercel 배포 (`apps/web`)

### 6-1. 프로젝트 생성

1. Vercel -> `Add New...` -> `Project`
2. 같은 GitHub 레포 선택
3. Root Directory: `apps/web`
4. 배포 URL 확인: `https://tickasting.studioliq.com`

### 6-2. Env 설정

빠른 적용(권장):

- `deploy/env/vercel-web.env` 파일 내용을 Vercel `Settings -> Environment Variables`에 한 번에 붙여넣기
- `Production/Preview/Development` 타겟을 원하는 범위로 지정

필수:

- `NEXT_PUBLIC_API_URL=https://api-tickasting.studioliq.com`
- `NEXT_PUBLIC_WS_URL=wss://api-tickasting.studioliq.com` (옵션, 미설정 시 `NEXT_PUBLIC_API_URL`에서 자동 유도)
- `NEXT_PUBLIC_EVM_EXPLORER_URL=https://explorer.testnet.kasplextest.xyz`
- `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54`
- `NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL=USDC`
- `NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS=6`
- `NEXT_PUBLIC_KASPLEX_CHAIN_ID=167012`

변경 후 재배포 필수.

---

## 7) 컨트랙트 배포 (선택/최초 1회)

`contracts/.env`:

```dotenv
CONTRACT_RPC_URL=https://rpc.kasplextest.xyz
DEPLOYER_PRIVATE_KEY=<private-key>
```

```bash
pnpm --filter @tickasting/contracts compile
pnpm --filter @tickasting/contracts test
pnpm --filter @tickasting/contracts deploy:kasplex-testnet
pnpm --filter @tickasting/contracts export-abi
```

배포된 주소를 `TICKASTING_CONTRACT_ADDRESS`로 반영 후 Ponder 재배포.

그리고 API/웹에서도 해당 주소를 사용하는 환경변수를 갱신 후 재배포.

---

## 8) 스모크 테스트 (체크리스트)

1. API health:

```bash
curl https://api-tickasting.studioliq.com/health
```

2. Ponder health:

```bash
# Ponder를 Private으로 두면 Railway 내부 네트워크/Service Domain 기준으로 확인
curl https://<ponder-domain>/health
curl https://<ponder-domain>/ready
```

3. 세일 생성/퍼블리시:

```bash
curl -X POST https://api-tickasting.studioliq.com/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Aurora Pulse Live in Seoul 2026","venue":"Jamsil Indoor Arena"}'
```

```bash
curl -X POST https://api-tickasting.studioliq.com/v1/events/<eventId>/sales \
  -H "Content-Type: application/json" \
  -d '{
    "network":"kasplex-testnet",
    "treasuryAddress":"0x<YOUR_EVM_TREASURY_ADDRESS>",
    "ticketPriceSompi":"100000",
    "supplyTotal":10,
    "finalityDepth":12
  }'
```

```bash
curl -X POST https://api-tickasting.studioliq.com/v1/sales/<saleId>/publish
```

4. 프론트에서 MetaMask로 구매 tx 실행
5. `https://tickasting.studioliq.com`에서 구매/내 티켓/티켓상세(양도/취소) 확인
6. `https://api-tickasting.studioliq.com/v1/sales/<saleId>/my-status?txid=...`에서 상태 확인
7. `https://api-tickasting.studioliq.com/v1/sales/<saleId>/allocation`에서 랭킹 확인

성공 기준:

- 정렬이 온체인 블록/로그 순서와 일치
- winner 수가 supply 이내
- commit/merkle-proof API 동작

---

## 9) 트러블슈팅

### 9-1. 구매 tx가 status에 안 뜸

1. Ponder `/ready` 먼저 확인
2. `PAYMENT_TOKEN_ADDRESS`가 USDC 주소와 일치하는지 확인
3. `treasuryAddress`가 EVM 주소인지 확인 (`0x...`)
4. `USDC_TRANSFER_START_BLOCK`가 너무 최근으로 잡혀있지 않은지 확인

### 9-2. confirmations가 0으로 멈춤

1. `CONTRACT_RPC_URL`/`PONDER_RPC_URL_167012` 확인
2. RPC 응답 지연/오류 로그 확인

### 9-3. 웹에서 체인 전환 실패

1. MetaMask에서 chainId `167012` 수동 추가/전환
2. 브라우저에서 지갑 확장 팝업 차단 여부 확인
