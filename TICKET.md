## TICKET.md

```md
# GhostPass — TICKET Backlog (순차 실행용)

## 0) 사용법(중요)
- 이 파일은 “실행 순서”다. 위에서 아래로 처리한다.
- Claude는 **완료되지 않은([ ]) 티켓 중 가장 위에 있는 것부터** 처리한다.
- 티켓 완료 시:
  - [x] 체크
  - 완료일(YYYY-MM-DD)
  - PR/commit 해시(가능하면)
  - 구현 메모(특이사항/결정사항/추가 티켓 필요)
- 각 티켓은 “Definition of Done”을 만족해야 완료 처리한다.

---

## 1) Definition of Done (DoD)
- 코드가 빌드/테스트를 통과한다(최소: lint + typecheck).
- 문서(README/주석/설정)가 재현 가능하다.
- 보안상 민감정보(키/API키)가 레포에 커밋되지 않는다.
- 티켓의 Acceptance Criteria를 충족한다.
- 기능이 동작하는 최소 데모 루트가 존재한다(해당 티켓 범위).

---

## 2) 공통 규칙
- 언어: 코드/README는 영어 권장(해커톤 제출 대비). 내부 문서(PROJECT/TICKET)는 한국어 유지.
- 환경변수는 .env.example에 선언하고 실제 값은 .env로 사용(커밋 금지).
- Kaspa 연동은 Adapter 인터페이스로 추상화(Provider 교체 가능해야 함).
- 실시간은 WebSocket 우선(필요 시 SSE 병행).

---

## 3) 티켓 목록 (순차)

### GP-001 — 모노레포/프로젝트 스캐폴딩
- Priority: P0
- Dependencies: 없음
- Goal: 레포 뼈대를 만들고, 로컬에서 web/api/indexer가 동시에 뜨는 상태까지 만든다.

#### Tasks
- monorepo 세팅(pnpm workspace + turbo/nx 중 택1)
- apps/web (Next.js TS)
- apps/api (Node TS, Fastify 권장)
- apps/indexer (Node TS)
- packages/shared (TS lib)
- infra/docker-compose: postgres + redis
- eslint/prettier/tsconfig base 세팅
- healthcheck endpoints:
  - api: GET /health
  - indexer: GET /health
- README 최소 골격(영문) + 실행 명령

#### Acceptance Criteria
- `pnpm install` 후 `pnpm dev`로 web/api/indexer가 모두 실행된다.
- /health 응답이 정상(200, json)이다.
- docker compose로 postgres/redis가 뜬다.
- 레포에 LICENSE(MIT 권장)와 .env.example이 존재한다.

#### Status
- [x] Done (2026-02-02)

---

### GP-002 — DB 스키마/마이그레이션(Prisma) 구축
- Priority: P0
- Dependencies: GP-001
- Goal: PROJECT.md에 정의된 핵심 테이블을 Prisma로 구성하고 마이그레이션 가능하게 만든다.

#### Tasks
- Prisma 도입(apps/api 기준)
- tables: events, sales, purchase_attempts, tickets, scans
- enum 정의(validation_status, sale_status, ticket_status)
- seed 스크립트(샘플 이벤트/세일 1개)
- api에서 DB 연결 테스트(간단 CRUD)

#### Acceptance Criteria
- `pnpm db:migrate` / `pnpm db:seed` 동작
- seed 후 sales 1개가 생성됨
- api가 DB 연결 문제 없이 기동

#### Status
- [x] Done (2026-02-02)

---

### GP-003 — Shared: Payload 인코더/디코더 + PoW 검증 라이브러리
- Priority: P0
- Dependencies: GP-001
- Goal: payload 포맷 v1과 PoW를 packages/shared에서 구현한다.

#### Tasks
- payload schema(v1) 구현(encode/decode)
- encode 결과는 hex string 반환
- decode는 validation 포함(길이, magic, version)
- PoW:
  - solvePow({saleId, buyerAddrHash, difficulty}) -> nonce
  - verifyPow({saleId, buyerAddrHash, difficulty, nonce}) -> boolean
- unit tests(vitest):
  - encode/decode roundtrip
  - verifyPow true/false 케이스
  - difficulty edge 케이스(0, 8, 16, 24)

#### Acceptance Criteria
- shared 패키지 단독 테스트 통과
- payload 예시를 docs에 1개 기록

#### Status
- [x] Done (2026-02-02)

---

### GP-004 — API: Event/Sale CRUD + Publish/Finalize 상태 머신
- Priority: P0
- Dependencies: GP-002
- Goal: Organizer용 최소 API를 만든다.

#### Tasks
- endpoints:
  - POST /v1/events
  - POST /v1/events/:eventId/sales
  - POST /v1/sales/:saleId/publish
  - POST /v1/sales/:saleId/finalize
  - GET /v1/sales/:saleId
- 입력 검증(Zod)
- sale status 규칙:
  - scheduled -> live(publish)
  - live -> finalizing(finalize)
  - finalizing -> finalized(indexer가 완료 처리)
- simple auth(해커톤 MVP):
  - organizerToken 헤더(환경변수)로 보호(옵션)

#### Acceptance Criteria
- Postman/curl로 event/sale 생성, publish 가능
- GET /v1/sales/:saleId로 설정값 반환(가격/주소/난이도/finalityDepth 포함)

#### Status
- [x] Done (2026-02-02)

---

### GP-005 — Kaspa Adapter 인터페이스 + Kas.fyi 구현체(빠른 MVP)
- Priority: P0
- Dependencies: GP-001
- Goal: indexer에서 사용할 KaspaAdapter를 정의하고, Kas.fyi API 기반 구현을 만든다.

#### Tasks
- packages/shared 또는 apps/indexer에 adapter interface 정의
- KasFyiAdapter 구현:
  - getAddressTransactions(address, {acceptedOnly?, includePayload?, cursor?})
  - getTransactionsAcceptance(txids[])
  - getTransactionsDetails(txids[], includePayload)
  - getBlockDetails(hash)  // acceptingBlockHash의 blueScore 필요
- rate limit / backoff / retry
- env:
  - KASFYI_API_KEY
  - KASFYI_BASE_URL(default https://api.kas.fyi)
- mock 테스트(네트워크 없이도 interface 테스트 가능하게)

#### Acceptance Criteria
- 실제 환경에서 특정 address tx 조회가 동작(수동 테스트)
- acceptance 조회로 isAccepted/confirmations/acceptingBlockHash를 가져온다.

#### Status
- [x] Done (2026-02-02)

---

### GP-006 — Indexer: Treasury Address 입금 트랜잭션 감지(폴링)
- Priority: P0
- Dependencies: GP-004, GP-005
- Goal: 특정 sale의 treasuryAddress로 들어오는 트랜잭션을 감지해 purchase_attempts에 적재한다.

#### Tasks
- indexer가 DB에 접속할 수 있게 구성
- sale status=live 인 sales를 주기적으로 로드
- 각 sale마다:
  - getAddressTransactions(treasuryAddress, includePayload=true, acceptedOnly=false)
  - 이미 본 txid는 스킵(마지막 cursor 또는 txid set)
  - 신규 txid를 purchase_attempts에 INSERT
- dedup key: (saleId, txid)
- detected_at 기록
- validation_status 초기값 pending

#### Acceptance Criteria
- sale live 상태에서 실제 입금 tx가 DB에 기록된다.
- 중복 기록이 발생하지 않는다.

#### Status
- [ ] Done

---

### GP-007 — Indexer: 구매 트랜잭션 검증(금액/주소/payload/PoW)
- Priority: P0
- Dependencies: GP-003, GP-006
- Goal: purchase_attempts를 VALIDATED(valid/invalid)로 분류한다.

#### Tasks
- rules:
  - outputs 중 treasuryAddress로 ticketPriceSompi 전송 필수
  - payload 있으면:
    - magic/saleId/version 검증
    - PoW verify
    - buyerAddrHash 추출
  - payload 없으면:
    - invalid 처리(또는 fallback 모드 지원 — 별도 티켓으로 분리)
- invalid_reason 표준화
- validation_status 업데이트:
  - valid
  - invalid_wrong_amount
  - invalid_missing_payload
  - invalid_pow
  - invalid_bad_payload
- 검증 로직 unit test(샘플 tx json fixture)

#### Acceptance Criteria
- valid/invalid 케이스가 DB에 반영된다.
- shared payload/PoW 로직을 사용한다.

#### Status
- [ ] Done

---

### GP-008 — Indexer: Acceptance/Confirmations 추적(폴링) + 상태 머신 업데이트
- Priority: P0
- Dependencies: GP-005, GP-007
- Goal: VALIDATED tx의 acceptance 상태를 추적하고 ACCEPTED/FINAL로 전환한다.

#### Tasks
- valid txids 배치로 모아 getTransactionsAcceptance 호출(최대 500 제한 고려)
- isAccepted/acceptingBlockHash/confirmations 업데이트
- acceptingBlockHash의 blueScore 필요 시 getBlockDetails로 보강
- FINALITY_DEPTH 도달 시 final 후보로 표시

#### Acceptance Criteria
- DB에 accepted/confirmations가 지속 업데이트된다.
- confirmations가 FINALITY_DEPTH를 넘으면 final-ready 상태가 된다.

#### Status
- [ ] Done

---

### GP-009 — Ordering: 결정적 순번(provisional/final) 산출 및 DB 반영
- Priority: P0
- Dependencies: GP-008
- Goal: sale별로 rank를 산출하고 purchase_attempts에 provisional_rank/final_rank를 기록한다.

#### Tasks
- 정렬 키:
  - acceptingBlockBlueScore asc
  - tiebreaker: txid asc
- provisionalRank: accepted=true 인 valid tx 전체 정렬
- finalRank: confirmations >= finalityDepth 인 tx만 정렬
- supply_total 기준 winner/loser 계산은 이후 티켓에서 처리(또는 여기서 플래그 추가)

#### Acceptance Criteria
- rank가 안정적으로 계산되고 DB에 기록된다.
- 같은 데이터 입력이면 항상 동일한 rank가 나온다(테스트).

#### Status
- [ ] Done

---

### GP-010 — API: Buyer 조회(my-status) + Sale realtime 스트림(WebSocket)
- Priority: P0
- Dependencies: GP-009
- Goal: 프론트가 필요한 실시간 데이터/내 상태 조회를 제공한다.

#### Tasks
- GET /v1/sales/:saleId/my-status?txid=
  - validation_status, accepted, confirmations, ranks 반환
- WS /ws/sales/:saleId
  - 주기적으로 supply/attempts/accepted/finalized 통계 broadcast
  - attempt 이벤트(신규/상태 변화) broadcast
- Redis pubsub 또는 in-process event bus(간단 MVP)

#### Acceptance Criteria
- 프론트 없이도 websocket client로 이벤트가 수신된다.
- my-status 조회가 정상 동작한다.

#### Status
- [ ] Done

---

### GP-011 — Web: 지갑 연결(KasWare) + 구매(tx + payload) + PoW WebWorker
- Priority: P0
- Dependencies: GP-003, GP-004, GP-010
- Goal: “구매 버튼 누르면 PoW → sendKaspa(payload 포함) → txid 획득”을 구현한다.

#### Tasks
- KasWare 감지(window.kasware)
- connect(requestAccounts)
- getNetwork, getPublicKey(옵션)
- PoW WebWorker:
  - solvePow 후 payload 생성
- sendKaspa(toAddress, sompi, {payload, priorityFee})
  - payload는 hex string (KasWare 요구 포맷 확인)
- txid 반환받아 화면에 표시 + my-status 조회 시작

#### Acceptance Criteria
- 실제 tx가 브로드캐스트되고 txid를 얻는다.
- payload 포함 tx가 생성된다(가능한 환경에서).
- UI가 txid/상태를 표시한다.

#### Status
- [ ] Done

---

### GP-012 — Web: Live Dashboard(실시간 스트림/내 상태/랭크 시각화)
- Priority: P0
- Dependencies: GP-010, GP-011
- Goal: 심사위원용 “라이브로 줄이 서는” 화면을 완성한다.

#### Tasks
- WS 연결하여 실시간 attempt 스트림 표시
- 핵심 KPI:
  - remaining(= supply_total - finalizedWinners)
  - total attempts
  - accepted count
  - final winners count
- 내 tx 상태 패널:
  - provisionalRank / finalRank / confirmations
- Provisional vs Final UI 구분(색/배지)

#### Acceptance Criteria
- 2~3명이 동시에 구매하면 화면에 순번이 실시간으로 반영된다.
- Provisional → Final 변화가 보인다.

#### Status
- [ ] Done

---

### GP-013 — 결과 스냅샷(allocation.json) 생성 + Result Page
- Priority: P0
- Dependencies: GP-009, GP-012
- Goal: 판매 종료 후 결과를 파일로 만들고, 프론트에서 확인/다운로드 가능하게 한다.

#### Tasks
- indexer:
  - sale end_at 지나면 finalized 계산 트리거
  - allocation.json 생성(파일 저장 + DB 저장 or S3)
- api:
  - GET /v1/sales/:saleId/allocation (json 반환 or download)
- web:
  - Result page: winners 테이블 + txid 검색 + 다운로드

#### Acceptance Criteria
- sale 종료 후 allocation.json이 생성된다.
- winners 리스트가 finalRank 기준으로 정확히 1..supply_total이다.

#### Status
- [ ] Done

---

### GP-014 — Merkle Root 생성 + Commit Tx(선택이지만 강력 추천)
- Priority: P1
- Dependencies: GP-013
- Goal: 결과 조작 불가를 보여주는 merkle commit을 구현한다.

#### Tasks
- winners list로 merkle tree 생성
- merkleRoot를 sale에 저장
- commit tx 발행 방식 택1:
  - A) Organizer 전용 키(테스트키)로 payload에 merkleRoot 넣고 소액 송금 tx 발행
  - B) Organizer가 수동으로 발행(서버는 raw tx/pskt 생성)
- commit_txid 저장 + Result page에 표시

#### Acceptance Criteria
- merkleRoot가 생성되고 commit_txid가 기록된다.
- 검증 가이드(doc)에 “commit tx payload에서 merkleRoot 확인” 절차가 있다.

#### Status
- [ ] Done

---

### GP-015 — Bot Simulator(Stress Test) + 데모 스크립트
- Priority: P1
- Dependencies: GP-011~013
- Goal: “100명 봇이 동시에 공격해도 순번이 결정적으로 배분된다”를 재현한다.

#### Tasks
- scripts/bot-sim:
  - N개의 브라우저(Playwright) 또는 Node 기반 tx 발행(키 관리 주의)
  - 동시에 구매 실행
- 결과 수집:
  - txid 리스트
  - 최종 winners/losers
- 데모 스크립트(영문):
  - 3분 구성(문제→라이브→결과→검증)

#### Acceptance Criteria
- 로컬/스테이징에서 N=50 이상이 재현된다(시간 제한 고려)
- 영상 녹화 가이드를 포함한다.

#### Status
- [ ] Done

---

### GP-016 — 제출용 README(영문) / 실행 재현성 강화
- Priority: P0
- Dependencies: GP-001~013
- Goal: 해커톤 제출에 필요한 문서 품질을 만든다.

#### Tasks
- README.md 영문:
  - what/why/how
  - quickstart
  - env vars
  - demo steps
  - audit/verify steps
- docs/architecture.md
- docs/audit.md
- LICENSE 확인
- .env.example 최신화

#### Acceptance Criteria
- 외부인이 README만 보고 실행 가능
- 데모 시나리오가 3분 안에 수행 가능

#### Status
- [ ] Done

---

### GP-017 — Scanner MVP(웹) + QR 서명/검증
- Priority: P2
- Dependencies: GP-013
- Goal: “현장 입장” 데모 최소 버전.

#### Tasks
- ticket QR 생성(서버 서명)
- scan verify endpoint
- scan redeem endpoint(1회성)
- web scanner page(카메라 접근)

#### Acceptance Criteria
- QR 스캔하면 ok/deny가 나온다.
- 같은 티켓 2번 스캔은 deny 처리된다.

#### Status
- [ ] Done

---

### GP-018 — Fallback 모드: payload 미지원 지갑 대응(선택)
- Priority: P2
- Dependencies: GP-007
- Goal: payload 없는 tx도 최소한 sale 식별이 가능하도록 대응.

#### Tasks
- sale별 고유 결제 주소 생성(각 sale마다 unique address)
- payload 없으면:
  - 해당 주소로 ticketPrice 정확히 보내면 후보 인정
  - PoW는 약화(또는 off-chain proof로 대체)
- UI에서 “fallback 모드” 안내

#### Acceptance Criteria
- payload 없는 tx도 sale로 매칭된다.
- 다만 PoW가 없음을 명확히 표시한다.

#### Status
- [ ] Done

---

## 4) 완료 로그(자동 기록 영역)
(Claude가 완료 시 여기에 누적 기록)

- **GP-001** (2026-02-02): 모노레포 스캐폴딩 완료
  - pnpm workspace + turbo 구성
  - apps/web (Next.js 15), apps/api (Fastify 5), apps/indexer (Fastify 5)
  - packages/shared (TypeScript lib with placeholder exports)
  - infra/docker-compose.yml (PostgreSQL 16 + Redis 7)
  - /health endpoints 구현 및 테스트 완료
  - 포트: web=3000, api=4001, indexer=4002, postgres=5433

- **GP-002** (2026-02-02): Prisma DB 스키마/마이그레이션 완료
  - Prisma 5.22.0 도입 (apps/api)
  - 5개 테이블: events, sales, purchase_attempts, tickets, scans
  - 6개 enum: EventStatus, SaleStatus, ValidationStatus, TicketStatus, ScanResult
  - seed 스크립트: demo-event-001 + demo-sale-001
  - API health check에 DB 상태 포함
  - GET /v1/sales/:saleId 실제 DB 조회로 구현

- **GP-003** (2026-02-02): Payload/PoW 라이브러리 완료
  - payload.ts: encode/decode v1 (59 bytes binary → hex)
  - pow.ts: solvePow, verifyPow, countLeadingZeroBits
  - address.ts: computeBuyerAddrHash, verifyBuyerAddrHash
  - 28개 unit tests 통과 (payload 8, pow 14, address 6)

- **GP-004** (2026-02-02): Event/Sale CRUD API 완료
  - routes/events.ts: POST /v1/events, GET /v1/events/:eventId, GET /v1/events
  - routes/sales.ts: POST /v1/events/:eventId/sales, GET /v1/sales/:saleId
  - POST /v1/sales/:saleId/publish (scheduled → live)
  - POST /v1/sales/:saleId/finalize (live → finalizing)
  - Zod validation schemas

- **GP-005** (2026-02-02): Kaspa Adapter 인터페이스 완료
  - kaspa/types.ts: KaspaAdapter 인터페이스 정의
  - kaspa/kasfyi-adapter.ts: Kas.fyi API 구현 (retry/backoff 포함)
  - kaspa/mock-adapter.ts: 테스트용 Mock 어댑터
  - 8개 mock adapter tests 통과
