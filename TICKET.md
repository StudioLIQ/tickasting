## TICKET.md

```md
# Tickasting — TICKET Backlog (순차 실행용)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

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
- [x] Done (2026-02-02)

---

## 3.1) Contract + Multi Ticket Types (신규 에픽)

> 목표: Tickasting를 “오프체인 정렬 + 온체인 티켓 클래스/클레임” 구조로 확장한다.  
> 핵심: 한 판매(sale) 안에 여러 티켓 타입(VIP/R/스탠딩 등)을 두고, 최종 당첨자는 컨트랙트에서 타입별 티켓을 claim/mint 할 수 있어야 한다.

### GP-019 — Contract 트랙 결정 + 인터페이스 고정
- Priority: P0
- Dependencies: GP-018
- Goal: 컨트랙트 구현 전에 체인/표준/인터페이스를 고정한다.

#### Tasks
- 컨트랙트 트랙 결정:
  - A안) Kaspa 네이티브/KRC 계열
  - B안) EVM 계열 테스트넷(브릿지/앳테스테이션 연동)
- 최소 ABI/이벤트 스펙 문서화:
  - `createSale`
  - `defineTicketType`
  - `openClaim`
  - `claimTicket`
  - `finalizeSale`
- 오프체인 엔진과 컨트랙트 경계 정의(무엇을 체인에 기록/검증할지)
- `docs/contract-spec.md` 신규 작성

#### Acceptance Criteria
- 팀이 사용할 컨트랙트 트랙이 1개로 확정됨
- ABI/이벤트 초안이 문서에 고정됨
- 이후 티켓에서 참조 가능한 주소/네이밍 규칙이 정리됨

#### Status
- [x] Done (2026-02-14)

---

### GP-020 — DB 스키마: 멀티 티켓 타입 모델링
- Priority: P0
- Dependencies: GP-019
- Goal: sale 하위에 티켓 타입을 저장하고 시도/발급/클레임이 타입 단위로 연결되게 만든다.

#### Tasks
- Prisma 스키마 추가:
  - `ticket_types` (saleId, code, name, priceSompi, supply, metadataUri, sortOrder)
  - `tickets.ticketTypeId` FK
  - `purchase_attempts.requestedTicketTypeId` FK(nullable)
- 타입별 공급량/잔여량 계산 쿼리 반영
- seed 데이터에 2~3개 티켓 타입(VIP/R/GEN) 추가

#### Acceptance Criteria
- migration 적용 후 sale별 ticket types 조회 가능
- 티켓 발급 레코드가 ticket type과 연결됨
- 기존 단일 타입 sale도 깨지지 않음(기본 타입 자동 처리 또는 nullable 대응)

#### Status
- [x] Done (2026-02-14)

---

### GP-021 — Organizer API: 티켓 타입 CRUD + 판매 생성 확장
- Priority: P0
- Dependencies: GP-020
- Goal: Organizer가 sale 생성 시 여러 티켓 타입을 함께 정의할 수 있게 한다.

#### Tasks
- API 확장:
  - `POST /v1/events/:eventId/sales`에 `ticketTypes[]` 입력 지원
  - `GET /v1/sales/:saleId/ticket-types`
  - `POST /v1/sales/:saleId/ticket-types`
  - `PATCH /v1/sales/:saleId/ticket-types/:ticketTypeId`
- 검증 규칙:
  - 타입별 `priceSompi > 0`, `supply > 0`
  - 타입 합계 공급량과 sale 공급 정책 일관성 체크
  - 중복 code 금지

#### Acceptance Criteria
- 하나의 sale에 최소 2개 타입 생성 가능
- API 응답에 타입별 가격/공급량/잔여량 포함
- 잘못된 타입 구성은 4xx로 명확히 거절

#### Status
- [x] Done (2026-02-14)

---

### GP-022 — Contracts 패키지 스캐폴딩 + 배포 파이프라인
- Priority: P0
- Dependencies: GP-019
- Goal: 레포에 컨트랙트 패키지를 추가하고 testnet 배포 자동화를 마련한다.

#### Tasks
- `contracts/` 워크스페이스 추가(선택 툴체인: Foundry/Hardhat 중 1개)
- compile/test/deploy 스크립트 추가
- ABI 산출물을 `packages/shared` 또는 `apps/api`에서 읽을 수 있게 export
- `.env.example`에 계약 주소/배포키 변수 추가(실키는 커밋 금지)

#### Acceptance Criteria
- 로컬에서 컨트랙트 컴파일/테스트가 돌아감
- testnet 배포 명령 1개로 컨트랙트 주소를 얻을 수 있음
- ABI 버전이 앱 코드와 동기화됨

#### Status
- [x] Done (2026-02-14)

---

### GP-023 — Smart Contract: Sale + TicketType + Claim/Mint
- Priority: P0
- Dependencies: GP-022
- Goal: 타입별 공급량을 가진 티켓을 온체인에서 claim/mint 처리한다.

#### Tasks
- core contract 구현:
  - sale 생성/상태 관리
  - ticket type 등록(가격/공급량/메타데이터)
  - winner claim 시 타입별 mint
- 접근제어(organizer/admin), 재진입/중복클레임 방지
- 이벤트:
  - `SaleCreated`
  - `TicketTypeDefined`
  - `ClaimOpened`
  - `TicketClaimed`
  - `SaleFinalized`

#### Acceptance Criteria
- testnet에서 타입별 claim/mint 성공
- 타입별 공급량 초과 mint 불가
- 동일 winner의 중복 claim 차단

#### Status
- [x] Done (2026-02-14) — Implemented as part of GP-022

---

### GP-024 — Indexer/API: 컨트랙트 이벤트 연동 + 정산 동기화
- Priority: P1
- Dependencies: GP-023
- Goal: 오프체인 랭킹 결과와 온체인 claim/mint 상태를 동기화한다.

#### Tasks
- indexer에 contract event consumer 추가
- DB에 on-chain claim 상태/tx hash/토큰ID 저장
- 오프체인 winner 목록과 온체인 mint 결과 정합성 체크 job 추가
- mismatch 알림 로그/대시보드 추가

#### Acceptance Criteria
- claim 발생 시 API/Web 상태가 실시간 반영
- mismatch 탐지 케이스에서 운영자 알림 확인 가능

#### Status
- [x] Done (2026-02-14)

---

### GP-025 — Web: 티켓 타입 선택 + Claim UX
- Priority: P1
- Dependencies: GP-021, GP-023, GP-024
- Goal: 구매/결과/클레임 화면에서 타입별 UX를 제공한다.

#### Tasks
- sale 페이지에 타입 카드(VIP/R/GEN) 노출
- 타입별 가격/재고/품절 상태 표시
- winner 전용 claim 버튼 + 지갑 트랜잭션 처리
- claim 완료 후 티켓 상세(타입/토큰ID/QR) 표시

#### Acceptance Criteria
- 사용자 관점에서 타입 선택 → 당첨 확인 → claim 완료까지 1개 플로우로 동작
- 품절 타입 선택 불가

#### Status
- [x] Done (2026-02-14)

---

### GP-026 — 배포/운영 문서 업데이트 (Contract 포함)
- Priority: P1
- Dependencies: GP-022, GP-023
- Goal: 운영 문서를 “FE=Vercel, BE/DB=Railway, Contract=testnet” 기준으로 최종 정리한다.

#### Tasks
- `DEPLOY.md`에 컨트랙트 compile/deploy/env/address 등록 절차 추가
- `LOCAL.md`에 로컬 컨트랙트 테스트 및 testnet dry-run 절차 추가
- 데모 체크리스트에 “컨트랙트 주소/클레임 스모크 테스트” 항목 추가

#### Acceptance Criteria
- 신규 팀원이 문서만 보고 컨트랙트 포함 데모 환경 재현 가능
- 배포 체크리스트로 claim까지 검증 가능

#### Status
- [x] Done (2026-02-14)

---

## 3.2) Ponder + Railway + FE/BE 동기화 (신규 에픽)

> 목표: 인덱싱 계층을 `apps/indexer` 커스텀 루프에서 **Ponder 기반**으로 전환하고,  
> FE/BE/API/배포를 Railway(Postgres) 운영 구조에 맞게 한 번에 정렬한다.

### GP-027 — 아키텍처 확정: API + Ponder + Postgres(Railway)
- Priority: P0
- Dependencies: GP-019
- Goal: 런타임 토폴로지를 공식화하고, deprecated 경로를 명확히 지정한다.

#### Tasks
- 아키텍처 결정 문서화:
  - FE: Vercel
  - BE API: Railway
  - DB: Railway Postgres (single source of truth)
  - Indexing: Ponder worker/service
- 기존 `apps/indexer`의 역할을 `deprecated`로 명시
- 데이터 소스 책임 분리:
  - Ponder: 체인 이벤트/트랜잭션 인덱싱
  - API: 도메인 로직/권한/집계 응답

#### Acceptance Criteria
- `PROJECT.md`와 `DEPLOY.md`에 목표 아키텍처가 일치하게 반영됨
- 팀 내 “indexing은 Ponder로 간다” 결정이 문서로 고정됨

#### Status
- [x] Done (2026-02-14)

---

### GP-028 — Ponder 앱 스캐폴딩 + 워크스페이스 편입
- Priority: P0
- Dependencies: GP-027
- Goal: 레포에 Ponder 런타임을 추가하고 dev/build/run 가능한 상태를 만든다.

#### Tasks
- `apps/ponder` (또는 `apps/indexer-ponder`) 생성
- `ponder.config` + schema + indexing entrypoint 작성
- `pnpm-workspace.yaml`, turbo tasks에 ponder 앱 반영
- `pnpm dev` 시 api/web + ponder 동시 기동 옵션 제공

#### Acceptance Criteria
- 로컬에서 Ponder가 Postgres에 연결되어 기동됨
- 기본 health/log 확인 가능
- CI에서 ponder build/typecheck가 통과

#### Status
- [x] Done (2026-02-14)

---

### GP-029 — Contract 이벤트 인덱싱(Ponder) 구현
- Priority: P0
- Dependencies: GP-023, GP-028
- Goal: sale/ticketType/claim/mint 이벤트를 Ponder가 표준 테이블로 적재한다.

#### Tasks
- 인덱싱 대상 이벤트 매핑:
  - `SaleCreated`
  - `TicketTypeDefined`
  - `ClaimOpened`
  - `TicketClaimed`
  - `SaleFinalized`
- Ponder schema 설계:
  - sales_onchain
  - ticket_types_onchain
  - claims_onchain
  - token_ownership (필요 시)
- reorg-safe upsert/idempotency 처리

#### Acceptance Criteria
- testnet 이벤트 발생 시 Postgres에 지연 없이 반영됨
- 동일 블록 재처리/재기동 시 중복 데이터가 쌓이지 않음

#### Status
- [x] Done (2026-02-14) — Implemented as part of GP-028

---

### GP-030 — BE(API) 리팩터: Ponder 테이블 기반 조회/상태 동기화
- Priority: P0
- Dependencies: GP-029
- Goal: API가 기존 커스텀 indexer 의존을 제거하고 Ponder 결과를 사용하게 한다.

#### Tasks
- 조회/집계 쿼리 경로를 Ponder 테이블 기반으로 교체
- claim 상태/토큰ID/소유자 조회 endpoint 정비
- 기존 `apps/indexer` 관련 코드 경로 단계적 제거 플래그 추가
- 데이터 정합성 체크(job 또는 endpoint) 추가

#### Acceptance Criteria
- 핵심 API 응답이 Ponder 인덱싱 결과와 일치
- claim 이후 FE에서 상태 지연 없이 반영
- `apps/indexer` 미기동 상태에서도 주요 흐름 동작

#### Status
- [x] Done (2026-02-14)

---

### GP-031 — FE 업데이트: 멀티 티켓 타입 + 온체인 Claim UX
- Priority: P0
- Dependencies: GP-021, GP-030
- Goal: 프론트가 타입 선택/상태/클레임/완료 티켓을 일관된 플로우로 제공한다.

#### Tasks
- sale 상세에 ticket type 카드/재고/가격 노출
- 당첨자 전용 claim CTA + tx 진행 상태 표시
- claim 완료 후 tokenId/owner/QR 표시
- live/results 페이지에 타입별 통계 추가

#### Acceptance Criteria
- 사용자 플로우: 타입 인지 → 구매/대기 → 당첨 확인 → claim 완료가 끊김 없이 동작
- 실패 케이스(revert, already claimed, sold out) UX가 명확함

#### Status
- [x] Done (2026-02-14)

---

### GP-032 — Railway 배포 토폴로지 반영 (API + Ponder + Postgres)
- Priority: P0
- Dependencies: GP-028, GP-030
- Goal: Railway 운영 배포를 Ponder 포함 구조로 고정한다.

#### Tasks
- Railway 서비스 구성:
  - `tickasting-api`
  - `tickasting-ponder`
  - `tickasting-postgres`
- Build/Start 명령, env vars 문서화
- 헬스체크 및 재시작 정책 정의
- 초기 sync/replay 운영 절차(runbook) 작성

#### Acceptance Criteria
- Railway에서 API/Ponder/Postgres 3서비스 정상 기동
- 재배포/재시작 후 인덱싱 재개가 안정적

#### Status
- [x] Done (2026-02-14)

---

### GP-033 — 데이터 마이그레이션: Legacy indexer -> Ponder
- Priority: P1
- Dependencies: GP-030
- Goal: 기존 데이터와 신규 인덱싱 데이터의 연속성을 보장한다.

#### Tasks
- 마이그레이션 전략:
  - full reindex vs checkpoint 기준 incremental
- 백필 스크립트 작성
- 이행 기간 이중 기록/검증 모드(선택) 구현
- 컷오버 체크리스트 작성

#### Acceptance Criteria
- 컷오버 후 API 결과가 이전 대비 의미 있게 일치
- 데이터 유실/중복 없이 전환 완료

#### Status
- [ ] Todo

---

### GP-034 — 관측성/운영: Ponder 인덱싱 모니터링 + 장애대응
- Priority: P1
- Dependencies: GP-032
- Goal: 운영에서 인덱싱 지연/중단을 빠르게 감지하고 복구 가능하게 만든다.

#### Tasks
- 핵심 메트릭 정의:
  - last indexed block
  - chain head gap
  - processing lag
  - failed handler count
- 알람 룰/로그 필드 표준화
- 장애 대응 runbook(재동기화, 특정 블록 재처리) 문서화

#### Acceptance Criteria
- 인덱싱 중단 시 5분 내 감지 가능한 알람 체계 확보
- 운영자가 문서만 보고 재동기화를 수행 가능

#### Status
- [ ] Todo

---

### GP-035 — Legacy Indexer 제거 + 코드 정리
- Priority: P1
- Dependencies: GP-030, GP-032, GP-033
- Goal: `apps/indexer` 기반 경로를 정식 제거하고 Ponder 단일 경로로 수렴한다.

#### Tasks
- `apps/indexer` 의존 스크립트/문서/환경변수 제거
- API의 legacy fallback code 제거
- CI 파이프라인에서 legacy indexer job 제거
- README/DEPLOY/LOCAL 최종 정리

#### Acceptance Criteria
- 배포/로컬 어디에서도 `apps/indexer` 없이 동작
- 문서/스크립트/CI가 Ponder 기준으로 일관됨

#### Status
- [ ] Todo

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

- **GP-006** (2026-02-02): Treasury 스캔 폴링 완료
  - Prisma 클라이언트 indexer에 추가 (api schema 공유)
  - TreasuryScanner 클래스: live sales 폴링, purchase_attempts INSERT
  - createScannerLoop: 설정 가능한 폴링 인터벌
  - /health: DB 상태, live sales 카운트 포함
  - /stats: 모니터링 엔드포인트
  - 7개 unit tests (mock adapter)

- **GP-007** (2026-02-02): 구매 트랜잭션 검증 완료
  - PurchaseValidator 클래스: pending attempts 검증
  - 검증 규칙: payload(magic/version/saleId), PoW, amount
  - ValidationStatus: valid/invalid_* 6가지 상태
  - Validator loop 통합 (scanner 후 실행)
  - validatePayloadOnly 유틸 함수
  - 10개 unit tests

- **GP-008** (2026-02-02): Acceptance/Confirmations 추적 완료
  - AcceptanceTracker 클래스: valid attempts 추적
  - 배치 API 호출 (configurable batch size)
  - 추적 필드: accepted, acceptingBlockHash, blueScore, confirmations
  - 새로 accepted/final 된 attempts 감지
  - Tracker loop 통합
  - 8개 unit tests

- **GP-009** (2026-02-02): 결정적 순번 산출 완료
  - OrderingEngine 클래스: deterministic 랭킹 계산
  - 정렬 키: acceptingBlueScore ASC, txid lexicographic ASC
  - provisionalRank: 모든 accepted valid attempts
  - finalRank: confirmations >= finalityDepth만
  - getSaleRankings 유틸 함수
  - Ordering loop 통합
  - 8개 unit tests

- **GP-010** (2026-02-02): Buyer API + WebSocket 완료
  - GET /v1/sales/:saleId/my-status?txid= - 구매 상태 조회
  - GET /v1/sales/:saleId/stats - 판매 통계
  - WS /ws/sales/:saleId - 실시간 stats broadcast
  - ping/pong, get_stats, get_my_status 메시지 지원
  - Sale별 연결 풀링

- **GP-011** (2026-02-02): Web 지갑 + 구매 완료
  - useKasware 훅: 지갑 연결, 계정 관리, sendKaspa
  - lib/pow.ts: 브라우저 PoW (Web Crypto API)
  - lib/api.ts: API 클라이언트
  - app/sales/[saleId]/page.tsx: 구매 페이지
  - PoW 진행률 표시, 트랜잭션 상태 폴링, 랭크 표시

- **GP-012** (2026-02-02): Live Dashboard 완료
  - useSaleWebSocket 훅: WebSocket 연결, 자동 재연결
  - app/sales/[saleId]/live/page.tsx: 라이브 대시보드
  - 실시간 stats, 진행률 바, 큐 상태 시각화

- **GP-013** (2026-02-02): 결과 스냅샷 + Results 페이지 완료
  - indexer/allocation.ts: AllocationSnapshot 생성
  - GET /v1/sales/:saleId/allocation 엔드포인트
  - Results 페이지: 요약, 검색, 당첨자 테이블, JSON 다운로드

- **GP-014** (2026-02-02): Merkle Root 생성 + Commit Tx 완료
  - packages/shared/src/merkle.ts: merkle tree 유틸리티
  - computeMerkleRoot, generateMerkleProof, verifyMerkleProof
  - createCommitPayload, parseCommitPayload
  - POST /v1/sales/:saleId/commit 엔드포인트
  - GET /v1/sales/:saleId/merkle-proof 엔드포인트
  - Results 페이지에 merkle commit 섹션 추가
  - docs/audit.md 검증 가이드 작성
  - 21개 unit tests

- **GP-015** (2026-02-02): Bot Simulator + Demo Scripts 완료
  - scripts/bot-sim: 스트레스 테스트 도구
  - simulate.ts: N개 mock purchase attempts 생성
  - verify-ordering.ts: 결정적 랭킹 검증
  - demo-scenario.ts: 완전한 데모 시나리오
  - README.md: 데모 녹화 가이드 포함
  - N=50+ 봇 시뮬레이션 지원

- **GP-017** (2026-02-02): Scanner MVP 완료
  - packages/shared/src/ticket.ts: QR 서명/검증 유틸리티
  - POST /v1/sales/:saleId/tickets/:txid/issue - 티켓 발급
  - POST /v1/scans/verify - 검증 (읽기 전용)
  - POST /v1/scans/redeem - 검증 + 사용 처리 (1회성)
  - apps/web/app/scanner: 웹 스캐너 페이지
  - 14개 unit tests

- **GP-016** (2026-02-02): README 및 문서 완료
  - README.md 전면 개정: quickstart, env vars, demo steps, API 목록
  - .env.example 최신화 (Web 환경변수 추가)
  - LICENSE (MIT)

- **GP-018** (2026-02-02): Fallback 모드 구현 완료
  - DB 스키마: sales 테이블에 `fallback_enabled` 필드 추가
  - ValidationStatus enum에 `valid_fallback` 상태 추가
  - Indexer validator: fallback 모드에서 payload 없이 amount만 검증
  - API: sale 생성/조회 시 fallbackEnabled 지원
  - Web: fallback 모드 안내 UI, PoW 스킵 로직
  - acceptance-tracker, ordering: valid_fallback 상태 처리
  - 33개 indexer 테스트, 71개 shared 테스트 통과

- **GP-019** (2026-02-14): Contract 트랙 결정 + 인터페이스 고정
  - Track: EVM Testnet (Sepolia) + Hardhat + Solidity (ERC-721)
  - Rationale: Kaspa에 범용 스마트 컨트랙트 VM 부재, EVM은 성숙한 툴링 제공
  - Hybrid architecture: Kaspa(공정 순번) + EVM(소유권 확정)
  - Contract: TickastingSale (ERC-721 + Merkle proof claim)
  - ABI: createSale, defineTicketType, openClaim, claimTicket, finalizeSale
  - Events: SaleCreated, TicketTypeDefined, ClaimOpened, TicketClaimed, SaleFinalized
  - Merkle leaf: keccak256(claimer, ticketTypeCode, kaspaTxid, finalRank)
  - docs/contract-spec.md 전면 개정, .env.example 업데이트

- **GP-020** (2026-02-14): DB 스키마 멀티 티켓 타입 모델링 완료
  - TicketType 모델 추가 (saleId, code, name, priceSompi, supply, metadataUri, perk, sortOrder)
  - PurchaseAttempt에 requestedTicketTypeId FK 추가 (nullable)
  - Ticket에 ticketTypeId FK, claimTxid, tokenId 추가
  - Sale에 claimContractAddress 추가
  - @@unique([saleId, code]) 제약조건
  - Seed: VIP (5 KAS, 10장), R (2 KAS, 40장), GEN (1 KAS, 50장)
  - Migration 적용 + 71 shared tests, 33 indexer tests 통과

- **GP-021** (2026-02-14): Organizer API 티켓 타입 CRUD 완료
  - Sale 생성 시 ticketTypes[] 입력 지원 (inline creation)
  - GET /v1/sales/:saleId/ticket-types (타입별 가격/공급량/잔여량)
  - POST /v1/sales/:saleId/ticket-types (개별 타입 추가)
  - PATCH /v1/sales/:saleId/ticket-types/:ticketTypeId (타입 수정)
  - 검증: 중복 code 409, 비공개 sale만 수정 가능, priceSompi/supply 양수
  - GET /v1/sales/:saleId 응답에 ticketTypes 포함
  - Zod 스키마: ticketTypeSchema, updateTicketTypeSchema 추가

- **GP-022** (2026-02-14): Contracts 패키지 스캐폴딩 + 배포 파이프라인 완료
  - contracts/ 워크스페이스: Hardhat + Solidity 0.8.24
  - TickastingSale.sol: ERC-721 + Merkle proof claim 컨트랙트
  - OpenZeppelin: ERC721Enumerable, Ownable, ReentrancyGuard, MerkleProof
  - 13개 contract tests 통과 (createSale, defineTicketType, claimTicket, finalizeSale)
  - deploy script (localhost/sepolia), export-abi script
  - ABI exported to packages/shared/abi/TickastingSale.json (64 entries)
  - pnpm-workspace에 contracts 등록

- **GP-023** (2026-02-14): GP-022에서 함께 완료
  - TickastingSale.sol에 모든 AC 충족: claim/mint, supply cap, duplicate prevention
  - 5개 이벤트 구현: SaleCreated, TicketTypeDefined, ClaimOpened, TicketClaimed, SaleFinalized
  - Merkle proof 기반 claim 검증, ReentrancyGuard 적용

- **GP-024** (2026-02-14): Indexer/API 컨트랙트 이벤트 연동 완료
  - POST /v1/sales/:saleId/claims/sync — on-chain claim 동기화
  - GET /v1/sales/:saleId/claims — claim 상태 조회
  - GET /v1/sales/:saleId/claims/consistency — 오프체인 winners vs 온체인 claims 정합성 체크
  - PATCH /v1/sales/:saleId/contract — 컨트랙트 주소 등록
  - Ticket에 claimTxid, tokenId, ticketTypeId 연동

- **GP-025** (2026-02-14): Web 티켓 타입 선택 + Claim UX 완료
  - Sale 페이지에 ticket type 카드 UI (선택/가격/잔여량/품절)
  - 타입별 가격으로 구매 버튼 동적 변경
  - Winner claim 섹션 (MetaMask 안내 + 컨트랙트 주소)
  - API client에 TicketType, ClaimStatus 인터페이스 추가
  - getTicketTypes(), getClaimStatus() API 함수 추가

- **GP-026** (2026-02-14): 배포/운영 문서 업데이트 완료
  - DEPLOY.md에 컨트랙트 배포 절차 추가 (Sepolia compile/test/deploy/verify)
  - DEPLOY.md에 컨트랙트 초기화 절차 + API 주소 등록 절차 추가
  - DEPLOY.md에 컨트랙트 포함 데모 체크리스트 추가
  - LOCAL.md에 Hardhat 로컬 테스트 절차 + Sepolia dry-run 절차 추가
  - LOCAL.md에 ABI 동기화 절차 추가

- **GP-027** (2026-02-14): 아키텍처 확정 완료
  - Target: FE=Vercel, API=Railway, Indexing=Ponder(Railway), DB=Railway Postgres
  - `apps/indexer` deprecated, `apps/ponder` target으로 공식화
  - 데이터 소스 책임 분리: Ponder(체인 인덱싱) / API(도메인 로직)
  - docs/architecture.md 신규 작성 (ADR)
  - PROJECT.md 섹션 6 업데이트 (런타임 토폴로지 테이블, 책임 분리, 다이어그램)
  - DEPLOY.md/LOCAL.md/README.md 일관 반영

- **GP-028** (2026-02-14): Ponder 앱 스캐폴딩 + 워크스페이스 편입 완료
  - apps/ponder 생성 (ponder 0.16.3 + viem + hono)
  - ponder.config.ts: Sepolia chain + TickastingSale contract 설정
  - ponder.schema.ts: sales_onchain, ticket_types_onchain, claims_onchain, token_ownership
  - src/index.ts: 5개 이벤트 핸들러 (SaleCreated, TicketTypeDefined, ClaimOpened, TicketClaimed, SaleFinalized) + Transfer
  - src/api/index.ts: GraphQL + REST endpoints (/sales/:id, /sales/:id/claims, /sales/:id/ticket-types)
  - abis/TickastingSaleAbi.ts: ABI as const for type-safe indexing
  - ponder-env.d.ts, tsconfig.json, .env.example
  - pnpm-workspace에 자동 편입 (apps/* 패턴)
  - DEPLOY.md에 Ponder 서비스 명령어/환경변수 확정
  - typecheck 통과

- **GP-029** (2026-02-14): GP-028에서 함께 완료
  - 5개 TickastingSale 이벤트 + Transfer 핸들러 구현 (src/index.ts)
  - onchainTable 스키마: sales_onchain, ticket_types_onchain, claims_onchain, token_ownership
  - Ponder 프레임워크 내장 reorg-safe idempotency + checkpoint/replay

- **GP-030** (2026-02-14): BE(API) 리팩터 — Ponder 테이블 기반 조회/상태 동기화
  - ponder-client.ts 신규: Ponder 테이블 쿼리 유틸 (getPonderClaims, getPonderSale, ponderTablesExist)
  - USE_PONDER_DATA 환경변수 기반 데이터 소스 전환 (feature flag)
  - GET /v1/sales/:saleId/claims: ?source=ponder|legacy 쿼리 파라미터 지원
  - GET /v1/sales/:saleId/claims/consistency: Ponder 데이터 우선 사용 + claimSource 표시
  - /health 엔드포인트: ponder 상태 + usePonderData 필드 추가
  - Ponder 테이블 미존재 시 legacy 자동 fallback
  - typecheck 통과

- **GP-031** (2026-02-14): FE 업데이트 — 멀티 티켓 타입 + 온체인 Claim UX
  - live 페이지에 Ticket Types 섹션 추가 (타입별 가격/supply/claimed/remaining 바)
  - results 페이지에 Ticket Type Breakdown 섹션 추가 (타입별 supply/claimed/remaining)
  - 브랜딩 수정: GhostPass → Tickasting (live/results 페이지)
  - getTicketTypes API 호출 추가 (live/results 양쪽)
  - typecheck 통과

- **GP-032** (2026-02-14): Railway 배포 토폴로지 반영 완료
  - DEPLOY.md에 Ponder 헬스체크 정책 추가 (경로/포트/인터벌)
  - DEPLOY.md에 Ponder 초기 sync / 재동기화 runbook 추가
  - DEPLOY.md에 Ponder 장애 대응 가이드 추가 (7.4~7.6)
  - 데모 체크리스트에 Ponder 상태 확인 항목 추가
  - 업데이트 배포 루틴에 Ponder 재인덱싱 반영
  - DEPLOY.md에 컨트랙트 배포 절차 추가 (Sepolia compile/test/deploy/verify)
  - DEPLOY.md에 컨트랙트 초기화 절차 + API 주소 등록 절차 추가
  - DEPLOY.md에 컨트랙트 포함 데모 체크리스트 추가
  - LOCAL.md에 Hardhat 로컬 테스트 절차 + Sepolia dry-run 절차 추가
  - LOCAL.md에 ABI 동기화 절차 추가
