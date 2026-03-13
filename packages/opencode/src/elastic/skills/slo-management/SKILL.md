---
name: slo-management
description: >
  Use this skill when working with Elastic SLOs (Service Level Objectives).
  Activate when the user asks about SLO status, burn rates, error budgets,
  or needs to create and manage SLO definitions.
metadata:
  version: 0.1.0
  visibility: public
---

# Elastic SLO Management

## Checking SLO Status

List all SLOs and their current status:

```bash
elastic slos list
```

List SLO definitions for configuration review:

```bash
elastic slos list-definitions
```

## Understanding SLO Data

### Key Concepts

- **SLI (Service Level Indicator)**: the metric being measured (e.g., error rate, latency)
- **SLO target**: the goal percentage (e.g., 99.9% availability)
- **Error budget**: the allowed amount of "bad" time/events (e.g., 0.1% of the window)
- **Burn rate**: how fast the error budget is being consumed

### SLO Status Interpretation

| Status | Meaning | Action |
|--------|---------|--------|
| Healthy | Within error budget | No action needed |
| Degraded | Budget being consumed faster than expected | Monitor closely |
| Breached | Error budget exhausted | Immediate investigation required |

## Querying SLO Data via ES|QL

SLO data is stored in Elasticsearch indices. Query the rollup data:

```bash
elastic es query 'FROM .slo-observability.sli-v3* | STATS good = SUM(slo.numerator), total = SUM(slo.denominator) BY slo.id, slo.name | EVAL sli = good / total * 100 | SORT sli ASC | LIMIT 20'
```

## SLO Best Practices for SREs

1. **Start with user-facing SLOs** -- measure what customers experience
2. **Use error budgets for decision-making** -- if budget is healthy, ship faster; if degraded, focus on reliability
3. **Alert on burn rates, not thresholds** -- burn rate alerts catch sustained degradation without noisy spikes
4. **Review SLOs quarterly** -- adjust targets based on real-world performance
