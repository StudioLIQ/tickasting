# Ponder Indexing Monitoring & Incident Response

## Status
- **Created**: 2026-02-14 (GP-034)

## 1. Core Metrics

### 1.1 Ponder Built-in Endpoints

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `GET /health` | Process alive | 200 |
| `GET /ready` | Indexing caught up | 200 when synced |
| `GET /status` | Indexing progress | JSON with block numbers |
| `GET /metrics` | Prometheus metrics | text/plain |

### 1.2 Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| **Last indexed block** | `/status` | Chain head gap > 100 blocks |
| **Chain head gap** | Current block - last indexed | > 5 minutes behind |
| **Processing lag** | Time since last indexed block | > 5 minutes |
| **Failed handler count** | `/metrics` or logs | Any failures |
| **RPC error rate** | Ponder logs | > 5 errors/minute |
| **Database write latency** | Ponder internal | P99 > 1s |

### 1.3 API-side Monitoring

The API `/health` endpoint reports Ponder status:

```json
{
  "status": "ok",
  "service": "api",
  "db": "ok",
  "ponder": "ok",           // "ok" | "tables_missing" | "disabled"
  "usePonderData": true
}
```

Monitor for:
- `ponder: "tables_missing"` — Ponder tables not created yet
- `ponder: "disabled"` — `USE_PONDER_DATA` not set

## 2. Log Fields Standard

### 2.1 Ponder Log Fields

Ponder outputs structured logs. Key fields to filter:

| Field | Description |
|-------|-------------|
| `level` | `info`, `warn`, `error`, `fatal` |
| `message` | Human-readable description |
| `chain` | Chain name (e.g., `kasplexTestnet`) |
| `contract` | Contract name (e.g., `TickastingSale`) |
| `event` | Event name (e.g., `TicketClaimed`) |
| `blockNumber` | Block being processed |

### 2.2 Alert-worthy Log Patterns

```
level: "error"  → Any error
message: "RPC error" → Chain connectivity issue
message: "Handler error" → Indexing logic failure
message: "Database error" → Postgres connectivity
```

## 3. Alert Rules

### 3.1 Railway Monitoring

Railway provides basic health check monitoring. Configure:

| Setting | Value |
|---------|-------|
| Health Check Path | `/health` |
| Port | `42069` |
| Interval | `30s` |
| Timeout | `10s` |
| Unhealthy Threshold | `3` consecutive failures |
| Restart Policy | `Always` |

### 3.2 External Monitoring (Optional)

For production, add uptime monitoring:

```bash
# Check Ponder is alive and synced
curl -sf https://<ponder-internal-url>/ready || echo "ALERT: Ponder not ready"

# Check API reports Ponder OK
curl -s https://<api-url>/health | jq -e '.ponder == "ok"' || echo "ALERT: Ponder tables missing"
```

## 4. Incident Response Runbook

### 4.1 Ponder Service Crashes

**Symptoms**: Health check fails, no new events indexed.

**Steps**:
1. Check Railway service logs for crash reason
2. Common causes: OOM, RPC timeout, database connection exhausted
3. Railway auto-restarts the service — check if restart resolved it
4. If repeated crashes: check env vars, increase memory allocation

### 4.2 Indexing Stuck / Falling Behind

**Symptoms**: `/ready` returns non-200, chain head gap increasing.

**Steps**:
1. Check `/status` for last indexed block number
2. Check RPC provider status (Infura/Alchemy dashboard)
3. Check Postgres connection and available connections
4. If RPC rate limited: check `PONDER_RPC_URL_167012` plan limits
5. Restart Ponder — it resumes from checkpoint automatically

### 4.3 Handler Errors

**Symptoms**: Events indexed but handler throws error, data missing.

**Steps**:
1. Check Ponder logs for `"Handler error"` messages
2. Identify which event handler failed
3. Fix handler code in `apps/ponder/src/index.ts`
4. Deploy fix and restart — Ponder re-processes failed blocks

### 4.4 Database Schema Mismatch

**Symptoms**: Ponder fails to start, schema migration errors.

**Steps**:
1. Check Ponder logs for migration errors
2. If schema changed: Ponder auto-migrates on restart
3. If corrupted: DROP Ponder tables, restart for full reindex
4. Ensure DATABASE_URL is correct and Postgres version is 14+

### 4.5 Full Re-synchronization

When complete reindex is needed:

```bash
# 1. Stop Ponder service on Railway

# 2. Connect to Postgres and drop Ponder tables
psql $DATABASE_URL
DROP TABLE IF EXISTS sales_onchain CASCADE;
DROP TABLE IF EXISTS ticket_types_onchain CASCADE;
DROP TABLE IF EXISTS claims_onchain CASCADE;
DROP TABLE IF EXISTS token_ownership CASCADE;
-- Also drop Ponder internal tables
DROP TABLE IF EXISTS _ponder_meta CASCADE;
DROP TABLE IF EXISTS _ponder_reorg CASCADE;

# 3. Restart Ponder service on Railway
# It will reindex from TICKASTING_START_BLOCK
```

## 5. Performance Tuning

| Parameter | Default | Recommendation |
|-----------|---------|----------------|
| `pollingInterval` | 1000ms | 2000ms for Kasplex testnet (plenty fast) |
| `ethGetLogsBlockRange` | auto | Leave auto for Kasplex testnet |
| Postgres `max_connections` | 100 | Ensure room for Ponder + API |
| `TICKASTING_START_BLOCK` | 0 | Set to deploy block number |
