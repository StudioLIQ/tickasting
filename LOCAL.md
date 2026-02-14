# LOCAL.md - 로컬 개발/데모 가이드 (Vercel + Railway + Testnet 기준)

이 문서는 운영 배포 구조(`FE=Vercel`, `BE/DB=Railway`, `Network=testnet`)를 기준으로,
로컬에서 가장 빠르게 개발/데모 준비하는 방법을 정리합니다.

> **아키텍처 결정 (GP-027):** 인덱싱은 Ponder(`apps/ponder`)로 전환한다.
> `apps/indexer`는 deprecated이며 전환 완료(GP-035) 후 제거한다.
> 상세: `docs/architecture.md`

---

## 0) 로컬 실행 모드

## 모드 A: 웹만 로컬, API/DB는 Railway 사용 (데모 준비에 가장 빠름)

- 로컬에서 `apps/web`만 실행
- API/Indexer(Ponder)/DB는 Railway 인스턴스 사용
- 데모 직전 UI 확인에 적합

## 모드 B: 전체 로컬 실행 (기능 개발/디버깅용)

- web/api/ponder(target) + postgres를 로컬에서 실행
- 전환 완료 전에는 web/api/indexer(deprecated) + postgres/redis도 가능
- 코드 수정/디버깅에 적합

---

## 1) 공통 준비

필수:

- Node.js `>=20`
- pnpm `>=9`
- Docker + Docker Compose

설치 확인:

```bash
node -v
pnpm -v
docker --version
docker compose version
```

의존성 설치:

```bash
pnpm install
```

환경변수 파일 생성:

```bash
cp .env.example .env
```

---

## 2) 모드 A - 웹만 로컬 + Railway 백엔드

`.env`를 아래처럼 수정합니다.

```dotenv
NEXT_PUBLIC_API_URL=https://<tickasting-api-public-domain>
NEXT_PUBLIC_WS_URL=wss://<tickasting-api-public-domain>
KASPA_NETWORK=testnet
```

웹 실행:

```bash
pnpm --filter @tickasting/web dev
```

접속:

- `http://localhost:3000`

체크:

```bash
curl https://<tickasting-api-public-domain>/health
```

주의:
- `NEXT_PUBLIC_*` 변경 후에는 `web dev`를 재시작해야 반영됩니다.

---

## 3) 모드 B - 전체 로컬 실행

## 3.1 로컬 인프라 실행

```bash
docker compose -f infra/docker-compose.yml up -d
```

## 3.2 `.env` 기본값 확인

```dotenv
DATABASE_URL=postgresql://tickasting:tickasting@localhost:5433/tickasting?schema=public
API_HOST=0.0.0.0
API_PORT=4001
INDEXER_PORT=4002
KASPA_NETWORK=testnet
NEXT_PUBLIC_API_URL=http://localhost:4001
NEXT_PUBLIC_WS_URL=ws://localhost:4001
```

## 3.3 DB 준비

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

참고:
- migration이 꼬였거나 신규 환경이면 `pnpm db:push`를 사용해도 됩니다.

## 3.4 전체 실행

```bash
pnpm dev
```

확인:

```bash
curl http://localhost:4001/health
curl http://localhost:4002/health
curl http://localhost:4002/stats
```

Ponder 전환 후에는 `apps/ponder`의 health/log 확인 절차로 대체합니다.
`apps/indexer`의 health/stats 엔드포인트는 deprecated이며 전환 완료 후 제거됩니다.

---

## 4) Testnet 데모 데이터 만들기

현재 메인 UI는 관리자 생성 화면이 없으므로, 데모 세일은 API로 생성합니다.

1) 이벤트 생성

```bash
curl -X POST <API_BASE>/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Local Demo","venue":"Testnet"}'
```

2) 세일 생성 (`<eventId>` 교체)

```bash
curl -X POST <API_BASE>/v1/events/<eventId>/sales \
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
curl -X POST <API_BASE>/v1/sales/<saleId>/publish
```

`<API_BASE>` 값:

- 모드 A: `https://<tickasting-api-public-domain>`
- 모드 B: `http://localhost:4001`

브라우저 확인:

- `/sales/<saleId>`
- `/sales/<saleId>/live`
- `/sales/<saleId>/results`

---

## 5) 스크립트 기반 데모 데이터 (지갑 없이)

UI/백엔드 상태 확인만 빠르게 하려면:

```bash
cd scripts/bot-sim
pnpm install
pnpm demo -- --count=50 --supply=10
```

출력된 `saleId`로 페이지 확인:

- `http://localhost:3000/sales/<saleId>/live`
- `http://localhost:3000/sales/<saleId>/results`

---

## 6) 자주 막히는 이슈

## 6.1 Railway API 붙였는데 웹이 여전히 로컬 API를 호출함

- `NEXT_PUBLIC_API_URL` 변경 후 `pnpm --filter @tickasting/web dev` 재시작 필요

## 6.2 live 페이지에서 실시간 업데이트가 안 뜸

- `NEXT_PUBLIC_WS_URL`이 `wss://...`인지 확인
- API 서비스 로그에서 websocket 연결 로그 확인

## 6.3 Indexer가 testnet tx를 못 잡음

- `KASPA_NETWORK=testnet` 확인
- sale의 `network` 필드가 `testnet`인지 확인
- treasury 주소가 testnet 주소인지 확인

## 6.4 Prisma DB 연결 오류

- `DATABASE_URL` 확인
- `docker ps`에서 postgres 컨테이너 상태 확인
- 필요 시 재초기화:

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
pnpm db:push
pnpm db:seed
```

---

## 7) 컨트랙트 로컬 테스트

### 7.1 Hardhat 로컬 노드에서 테스트

```bash
# 컨트랙트 컴파일 + 테스트
pnpm --filter @tickasting/contracts compile
pnpm --filter @tickasting/contracts test

# 로컬 노드 실행 (별도 터미널)
pnpm --filter @tickasting/contracts exec hardhat node

# 로컬 배포
pnpm --filter @tickasting/contracts deploy:localhost
```

### 7.2 Sepolia Dry-run

Sepolia에 배포하기 전에 로컬에서 전체 플로우를 확인합니다:

1. `hardhat node` 실행
2. `deploy:localhost`로 배포
3. Hardhat console에서 `createSale`, `defineTicketType`, `openClaim`, `claimTicket` 순서 실행
4. 성공하면 Sepolia에 배포

### 7.3 ABI 동기화

컨트랙트를 수정한 경우 반드시:

```bash
pnpm --filter @tickasting/contracts compile
pnpm --filter @tickasting/contracts export-abi
```

이로써 `packages/shared/abi/TickastingSale.json`이 업데이트됩니다.

---

## 8) 데모 리허설 추천 순서

1. 모드 A로 웹 실행
2. Railway API `/health` 확인
3. 이벤트/세일 생성 (ticket types 포함) + publish
4. KasWare testnet으로 1회 구매
5. `live`/`results` 반영 확인
6. (선택) 컨트랙트 claim 스모크 테스트
7. 실패 시 로그 확인 후 env 재검증
