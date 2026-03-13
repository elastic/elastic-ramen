---
name: observability-rca
description: >
  Use this skill when performing root cause analysis on incidents detected
  by Elastic Observability. Activate when the user reports a production issue,
  outage, degraded performance, or asks to investigate alerts.
metadata:
  version: 0.1.0
  visibility: public
---

# Elastic Observability Root Cause Analysis

## Investigation Framework

### 1. Assess Scope

Start with high-level health checks:

```bash
elastic es cluster health
elastic slos list
```

Check for widespread vs isolated issues by querying error rates across services:

```bash
elastic es query 'FROM logs-* | WHERE @timestamp > NOW() - 1 HOUR AND log.level == "error" | STATS errors = COUNT(*) BY service.name | SORT errors DESC | LIMIT 20'
```

### 2. Timeline Reconstruction

Establish when the issue started:

```bash
elastic es query 'FROM logs-* | WHERE service.name == "<affected-service>" AND log.level == "error" | STATS errors = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute) | SORT bucket | LIMIT 120'
```

Look for deployment or config changes around that time:

```bash
elastic es query 'FROM logs-* | WHERE @timestamp > NOW() - 4 HOURS AND (message LIKE "*deploy*" OR message LIKE "*restart*" OR message LIKE "*config*") | SORT @timestamp DESC | LIMIT 20'
```

### 3. Correlation Analysis

**Cross-service dependencies:**
```bash
elastic es query 'FROM traces-* | WHERE @timestamp > NOW() - 1 HOUR AND service.name == "<service>" | STATS avg_duration = AVG(transaction.duration.us), error_rate = COUNT_DISTINCT(CASE(event.outcome == "failure", trace.id)) BY service.target.name | SORT avg_duration DESC'
```

**Infrastructure metrics:**
```bash
elastic es query 'FROM metrics-system.cpu-* | WHERE @timestamp > NOW() - 2 HOURS | STATS cpu = AVG(system.cpu.total.norm.pct) BY host.name, bucket = BUCKET(@timestamp, 5 minute) | WHERE cpu > 0.8 | SORT bucket'
```

**Network connectivity:**
```bash
elastic es query 'FROM metrics-system.network-* | WHERE @timestamp > NOW() - 1 HOUR | STATS dropped = SUM(system.network.in.dropped), errors = SUM(system.network.in.errors) BY host.name | WHERE dropped > 0 OR errors > 0'
```

### 4. Common Root Causes

| Symptom | Check | Likely Cause |
|---------|-------|-------------|
| High latency across services | CPU/memory metrics | Resource exhaustion |
| Intermittent 5xx errors | Dependency health | Downstream service failure |
| Connection timeouts | Network metrics | Network partition or DNS issue |
| Gradual degradation | Disk/memory trends | Resource leak |
| Sudden spike then recovery | Deploy logs | Bad deployment (auto-rolled-back) |

### 5. Resolution Documentation

After identifying root cause, document:
- **What happened**: observable symptoms
- **When**: timeline with key events
- **Root cause**: the underlying issue
- **Impact**: affected services, users, SLOs
- **Remediation**: what was done to fix it
- **Prevention**: how to prevent recurrence
