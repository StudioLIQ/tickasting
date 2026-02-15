# DEPLOY.md

인턴 온보딩 기준으로 작성한 Tickasting 배포 가이드입니다.  
이 문서 순서대로 진행하면 `Vercel + Railway` 배포를 재현할 수 있습니다.

## 0) 현재 배포 구조 (중요)

현재 코드 기준 운영 구조:

- `apps/web` -> Vercel (Public)
- `apps/api` -> Railway (Public)
- `apps/indexer` -> Railway (Private, Kaspa 스캔 필수)
- `apps/ponder` -> Railway (Private, EVM claim 인덱싱)
- PostgreSQL -> Railway (Internal)

주의:

- `apps/indexer`는 "EVM 인덱싱 기준"으로 deprecated지만, **Kaspa 구매 감지/검증/순위 계산은 아직 indexer가 담당**합니다.
- 즉, 현재 운영에서는 `api + indexer + postgres`가 core 필수이고, `ponder`는 claim/NFT 이벤트 가시화를 위해 추가됩니다.

## 0.1) 핵심 원칙: "온체인 기반 선착순"

Tickasting의 핵심은 아래입니다.

1. 선착순 결정의 **근거 데이터는 온체인(Kaspa acceptance)** 이다.
2. 정렬 규칙은 고정이다: `acceptingBlueScore ASC`, 동점이면 `txid ASC`.
3. 서버는 이 규칙으로 계산할 뿐, 임의 순번을 만들지 않는다.

정확한 표현:

- `완전 온체인 컨트랙트 내 계산`은 아님
- `온체인 데이터 기반 결정(검증 가능)`은 맞음

왜 이렇게 하는가:

- 구매 트랜잭션은 Kaspa 체인에 있고,
- claim/NFT는 EVM(Sepolia) 컨트랙트에서 처리되기 때문에
- 현재 구조는 "Kaspa 온체인 데이터 -> 서버 결정/검증 -> (선택) EVM claim 검증" 흐름이 현실적입니다.

## 1) 완료 기준 (먼저 읽기)

아래 8개가 모두 만족되면 배포 완료입니다.

1. Railway에 `api/indexer/ponder/postgres` 4개 서비스가 모두 running
2. API `/health` 응답의 `status=ok`, `db=ok`
3. Indexer `/health` 응답의 `status=ok`
4. Ponder `/ready`가 200
5. Vercel 최신 배포가 Ready
6. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`가 API 도메인을 가리킴
7. 이벤트 생성 -> 세일 생성 -> publish -> `/live` 페이지 반영 확인
8. `/allocation`에서 winner 목록이 `acceptingBlueScore/txid` 정렬 규칙과 일치

## 2) 사전 준비

### 2.1 계정/권한

- Railway 프로젝트 생성 권한
- Vercel 프로젝트 생성 권한
- GitHub 레포 접근 권한

### 2.2 로컬 도구

- Node.js `>=20`
- pnpm `>=9`

확인:

```bash
node -v
pnpm -v
```

### 2.3 사전 확보 값

- Sepolia RPC URL (`PONDER_RPC_URL_11155111`에 사용)
- (선택) 컨트랙트 배포용 private key + 테스트 ETH
- (운영) 충분히 긴 랜덤 문자열 (`TICKET_SECRET`)

## 3) Railway 프로젝트 생성

### Step 3-1. 새 Railway Project 생성

1. Railway 대시보드에서 `New Project`
2. `Deploy from GitHub Repo` 선택
3. 현재 레포 연결

### Step 3-2. PostgreSQL 서비스 추가

1. 프로젝트 내 `New` -> `Database` -> `Add PostgreSQL`
2. 서비스 이름을 `tickasting-postgres`로 변경 (권장)
3. 생성 후 `Variables`에서 `DATABASE_URL`이 있는지 확인

## 4) Railway 서비스 3개 추가

아래 3개를 같은 레포에서 각각 생성합니다.

- `tickasting-api`
- `tickasting-indexer`
- `tickasting-ponder`

중요:

- 이 레포는 workspace 모노레포입니다.
- 서비스별로 `apps/...`만 잘라 배포하지 말고, **레포 루트 기준 배포**로 설정합니다.

## 5) tickasting-api 설정 (Public)

### Step 5-1. 서비스 생성

1. `New` -> `GitHub Repo` -> 같은 레포 선택
2. 서비스 이름: `tickasting-api`

### Step 5-2. Deploy 설정

`Settings` -> `Deploy`에서 설정:

- Build Command

```bash
pnpm --filter @tickasting/api db:generate \
  && pnpm --filter @tickasting/shared build \
  && pnpm --filter @tickasting/api build
```

- Start Command

```bash
API_HOST=0.0.0.0 API_PORT=${PORT:-4001} pnpm --filter @tickasting/api start
```

### Step 5-3. Variables 설정

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `API_HOST=0.0.0.0`
- `TICKET_SECRET=<긴 랜덤 문자열>`

권장:

- `WS_BROADCAST_INTERVAL_MS=2000`
- `USE_PONDER_DATA=true`
- `PONDER_SCHEMA=public`

### Step 5-4. Networking

1. `Networking`에서 Public Domain 생성
2. 생성된 주소를 기록: `https://<api-domain>`

### Step 5-5. Healthcheck

- Path: `/health`
- Port: 서비스 기본 포트(`PORT`)

## 6) tickasting-indexer 설정 (Private)

### Step 6-1. 서비스 생성

1. `New` -> `GitHub Repo` -> 같은 레포 선택
2. 서비스 이름: `tickasting-indexer`

### Step 6-2. Deploy 설정

- Build Command

```bash
pnpm --filter @tickasting/indexer db:generate \
  && pnpm --filter @tickasting/shared build \
  && pnpm --filter @tickasting/indexer build
```

- Start Command

```bash
INDEXER_PORT=${PORT:-4002} pnpm --filter @tickasting/indexer start
```

### Step 6-3. Variables 설정

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `KASPA_NETWORK=testnet` (운영이 mainnet이면 mainnet)

권장:

- `INDEXER_POLL_INTERVAL_MS=5000`
- `KASFYI_API_KEY=<optional>`
- `KASFYI_BASE_URL=https://api.kas.fyi`

### Step 6-4. Healthcheck

- Path: `/health`
- Port: 서비스 기본 포트(`PORT`)

## 7) tickasting-ponder 설정 (Private)

### Step 7-1. 서비스 생성

1. `New` -> `GitHub Repo` -> 같은 레포 선택
2. 서비스 이름: `tickasting-ponder`

### Step 7-2. Deploy 설정

- Build Command (선택)

```bash
pnpm --filter @tickasting/ponder typecheck
```

- Start Command

```bash
pnpm --filter @tickasting/ponder start
```

### Step 7-3. Variables 설정

필수:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `PONDER_RPC_URL_11155111=https://sepolia.infura.io/v3/<key>`
- `TICKASTING_CONTRACT_ADDRESS=0x<deployed-contract-address>`

권장:

- `TICKASTING_START_BLOCK=<deploy-block-number>`

### Step 7-4. Healthcheck

- Path: `/health`
- Port: `42069` (Ponder 기본)

참고:

- Ponder readiness는 `/ready`로 확인합니다.

## 8) DB 초기화 (초기 1회)

API 서비스 Shell(또는 Railway Job)에서 실행:

```bash
pnpm --filter @tickasting/api db:generate
pnpm --filter @tickasting/api exec prisma migrate deploy
```

샘플 데이터 필요 시:

```bash
pnpm --filter @tickasting/api db:seed
```

## 9) Vercel 설정 (`apps/web`)

### Step 9-1. 프로젝트 생성

1. Vercel -> `Add New...` -> `Project`
2. 같은 GitHub 레포 선택
3. Framework: Next.js 자동 인식 확인
4. Root Directory를 `apps/web`로 지정

### Step 9-2. Environment Variables

필수:

- `NEXT_PUBLIC_API_URL=https://<api-domain>`
- `NEXT_PUBLIC_WS_URL=wss://<api-domain>`

주의:

- `NEXT_PUBLIC_*`는 빌드 타임 주입입니다.
- 값 변경 후에는 반드시 재배포가 필요합니다.

## 10) (선택) 컨트랙트 배포/연결

claim/NFT 발행 흐름을 쓰려면 Sepolia 컨트랙트가 필요합니다.

`contracts/.env` 예시:

```dotenv
CONTRACT_RPC_URL=https://sepolia.infura.io/v3/<your-key>
DEPLOYER_PRIVATE_KEY=<private-key>
ETHERSCAN_API_KEY=<optional>
```

배포:

```bash
pnpm --filter @tickasting/contracts compile
pnpm --filter @tickasting/contracts test
pnpm --filter @tickasting/contracts deploy:sepolia
pnpm --filter @tickasting/contracts export-abi
```

배포된 주소를 `tickasting-ponder`의 `TICKASTING_CONTRACT_ADDRESS`에 반영하고 재배포합니다.

필요 시 sale에 컨트랙트 주소 등록:

```bash
curl -X PATCH https://<api-domain>/v1/sales/<saleId>/contract \
  -H "Content-Type: application/json" \
  -d '{"claimContractAddress":"0x<deployed-address>"}'
```

## 11) 스모크 테스트 (반드시 실행)

### Step 11-1. 헬스체크

```bash
curl https://<api-domain>/health
curl https://<indexer-domain>/health
curl https://<ponder-domain>/health
curl https://<ponder-domain>/ready
```

API `/health`에서 확인할 값:

- `status: "ok"`
- `db: "ok"`
- `usePonderData: true` (설정한 경우)
- `ponder: "ok"` (Ponder 테이블 준비된 경우)

### Step 11-2. E2E 최소 흐름

이벤트 생성:

```bash
curl -X POST https://<api-domain>/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Railway Demo","venue":"Online"}'
```

세일 생성:

```bash
curl -X POST https://<api-domain>/v1/events/<eventId>/sales \
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
curl -X POST https://<api-domain>/v1/sales/<saleId>/publish
```

웹 확인:

- `https://<vercel-domain>/sales/<saleId>`
- `https://<vercel-domain>/sales/<saleId>/live`
- `https://<vercel-domain>/sales/<saleId>/results`

### Step 11-3. "온체인 기반 선착순" 검증

아래 API로 최종 스냅샷을 확인합니다.

```bash
curl https://<api-domain>/v1/sales/<saleId>/allocation
```

확인 포인트:

1. `orderingRule.primary`가 `acceptingBlockHash.blueScore asc`
2. `orderingRule.tiebreaker`가 `txid lexicographic asc`
3. `winners`가 위 규칙대로 정렬되어 있는지 샘플 몇 건 수동 확인

이 검증이 통과하면 "서버 시각"이 아니라 "체인 acceptance 기준"으로 선착순이 산정됨을 확인할 수 있습니다.

## 12) 자주 나는 문제와 해결

### 문제 1. API는 살아있는데 live 통계가 안 움직임

원인 후보:

- indexer down
- sale `network`와 indexer `KASPA_NETWORK` 불일치
- treasury 주소 네트워크 불일치

조치:

1. indexer `/health`, `/stats` 확인
2. indexer env 재검증
3. 문제 있으면 indexer 재배포

### 문제 2. API `/health`에서 `ponder=tables_missing`

원인:

- `USE_PONDER_DATA=true`인데 Ponder 테이블 미생성

조치:

1. Ponder 서비스가 동일 `DATABASE_URL` 쓰는지 확인
2. Ponder 서비스 재시작
3. `/ready`가 200 될 때까지 대기

### 문제 3. 프론트가 옛 API 주소를 계속 호출

원인:

- Vercel env 수정 후 재배포 누락

조치:

1. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` 확인
2. Vercel 재배포

## 13) 롤백 절차 (긴급)

### 13.1 API에서 Ponder 읽기 중단

1. API env에서 `USE_PONDER_DATA=false`
2. API 재배포

### 13.2 특정 서비스만 즉시 복구

1. Railway에서 해당 서비스 이전 성공 배포로 롤백
2. `/health` 정상 확인
3. E2E 최소 흐름 다시 확인

## 14) 인턴용 최종 체크리스트

배포 완료 보고 전에 아래를 체크해서 공유합니다.

1. 서비스 URL 3개 (API / Indexer / Ponder)
2. API `/health` JSON 캡처
3. Ponder `/ready` 200 캡처
4. Vercel 배포 URL
5. 이벤트/세일 생성 및 publish 성공 로그
6. `/live` 페이지 반영 캡처
