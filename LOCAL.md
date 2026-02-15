# LOCAL.md

Tickasting 로컬 실행 가이드 (모드 C 전용)입니다.  
이 문서는 **`Core + Ponder` 동시 실행**만 다룹니다.

- Core: `web + api + indexer + postgres`
- 확장: `ponder` (EVM claim/NFT 인덱싱)

## 1) 사전 준비

- Node.js `>=20`
- pnpm `>=9`
- Docker + Docker Compose

확인:

```bash
node -v
pnpm -v
docker --version
docker compose version
```

설치:

```bash
pnpm install
cp .env.example .env
```

## 2) `.env` 설정 (모드 C)

아래 값들을 `.env`에 채웁니다.

```dotenv
# Core
DATABASE_URL=postgresql://tickasting:tickasting@localhost:5433/tickasting?schema=public
API_HOST=0.0.0.0
API_PORT=4001
WS_BROADCAST_INTERVAL_MS=2000
TICKET_SECRET=dev-ticket-secret-change-in-prod

INDEXER_PORT=4002
INDEXER_POLL_INTERVAL_MS=5000
KASPA_NETWORK=testnet
KASFYI_API_KEY=
KASFYI_BASE_URL=https://api.kas.fyi

NEXT_PUBLIC_API_URL=http://localhost:4001
NEXT_PUBLIC_WS_URL=ws://localhost:4001

# Ponder
USE_PONDER_DATA=true
PONDER_SCHEMA=public
PONDER_RPC_URL_11155111=https://sepolia.infura.io/v3/<key>
TICKASTING_CONTRACT_ADDRESS=0x<deployed-address>
TICKASTING_START_BLOCK=<deploy-block>
```

## 3) 로컬 인프라 실행

```bash
docker compose -f infra/docker-compose.yml up -d
```

참고:

- `infra/docker-compose.yml`에는 postgres/redis가 올라갑니다.
- 현재 필수는 postgres입니다.

## 4) DB 초기화

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## 5) 서비스 실행 (모드 C)

터미널 1:

```bash
pnpm --filter @tickasting/shared dev
```

터미널 2:

```bash
pnpm --filter @tickasting/api dev
```

터미널 3:

```bash
pnpm --filter @tickasting/indexer dev
```

터미널 4:

```bash
pnpm --filter @tickasting/ponder dev
```

터미널 5:

```bash
pnpm --filter @tickasting/web dev
```

## 6) 상태 확인

```bash
curl http://localhost:4001/health
curl http://localhost:4002/health
curl http://localhost:4002/stats
curl http://localhost:42069/health
curl http://localhost:42069/ready
curl http://localhost:42069/status
```

정상 기준:

- API `/health`: `status=ok`, `usePonderData=true`, `ponder=ok`
- Indexer `/health`: `status=ok`
- Ponder `/ready`: 200

## 7) 데모 데이터 생성

이벤트 생성:

```bash
curl -X POST http://localhost:4001/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Local Demo","venue":"Testnet"}'
```

세일 생성:

```bash
curl -X POST http://localhost:4001/v1/events/<eventId>/sales \
  -H "Content-Type: application/json" \
  -d '{
    "network":"testnet",
    "treasuryAddress":"kaspa:<YOUR_TESTNET_TREASURY_ADDRESS>",
    "ticketPriceSompi":"100000000",
    "supplyTotal":10,
    "powDifficulty":8
  }'
```

세일 publish:

```bash
curl -X POST http://localhost:4001/v1/sales/<saleId>/publish
```

페이지 확인:

- `http://localhost:3000/sales/<saleId>`
- `http://localhost:3000/sales/<saleId>/live`
- `http://localhost:3000/sales/<saleId>/results`

## 8) 자주 막히는 이슈

### 8.1 API `/health`에 `ponder=tables_missing`

1. Ponder가 같은 `DATABASE_URL` 사용하는지 확인
2. Ponder 재시작
3. `/ready` 200까지 대기

### 8.2 live 업데이트가 멈춤

1. indexer `/health`, `/stats` 확인
2. `KASPA_NETWORK`와 sale `network` 값 일치 확인
3. `NEXT_PUBLIC_WS_URL` 확인

### 8.3 웹이 옛 API 주소를 호출

1. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` 확인
2. web dev 재시작

### 8.4 DB 재초기화

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
pnpm db:push
pnpm db:seed
```
