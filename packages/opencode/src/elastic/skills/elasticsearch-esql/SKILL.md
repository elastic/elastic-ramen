---
name: elasticsearch-esql
description: >
  Use this skill when writing or debugging ES|QL queries for Elasticsearch.
  Activate when the user asks to query logs, metrics, traces, or any
  Elasticsearch data using ES|QL syntax.
metadata:
  version: 0.1.0
  visibility: public
---

# Elasticsearch ES|QL Query Authoring

## ES|QL Basics

ES|QL (Elasticsearch Query Language) is a piped query language for filtering, transforming, and aggregating Elasticsearch data.

### Syntax

```
FROM <index-pattern>
| WHERE <condition>
| STATS <aggregation> BY <field>
| SORT <field> [ASC|DESC]
| LIMIT <n>
```

### Running Queries

Use the elastic CLI:
```bash
elastic es query 'FROM logs-* | WHERE @timestamp > NOW() - 1 HOUR | LIMIT 10'
```

### Common Patterns

**Filter by time range:**
```esql
FROM logs-*
| WHERE @timestamp > NOW() - 24 HOURS
```

**Count by field:**
```esql
FROM logs-*
| STATS count = COUNT(*) BY service.name
| SORT count DESC
```

**Percentiles:**
```esql
FROM metrics-apm*
| STATS p50 = PERCENTILE(transaction.duration.us, 50),
        p95 = PERCENTILE(transaction.duration.us, 95),
        p99 = PERCENTILE(transaction.duration.us, 99)
  BY service.name
```

**Time bucketing:**
```esql
FROM logs-*
| WHERE log.level == "error"
| STATS errors = COUNT(*) BY bucket = BUCKET(@timestamp, 5 minute)
| SORT bucket
```

**Multi-field filtering:**
```esql
FROM logs-*
| WHERE service.name == "api-gateway" AND http.response.status_code >= 500
| KEEP @timestamp, message, http.response.status_code, trace.id
| SORT @timestamp DESC
| LIMIT 50
```

### Type Functions

- `TO_STRING(field)`, `TO_INTEGER(field)`, `TO_DOUBLE(field)` -- type conversions
- `DATE_TRUNC(interval, field)` -- truncate timestamps
- `CONCAT(a, b)` -- string concatenation
- `LENGTH(field)` -- string length
- `TRIM(field)`, `LEFT(field, n)`, `RIGHT(field, n)` -- string manipulation

### Aggregation Functions

- `COUNT(*)`, `COUNT(field)`, `COUNT_DISTINCT(field)`
- `SUM(field)`, `AVG(field)`, `MIN(field)`, `MAX(field)`
- `PERCENTILE(field, pct)`, `MEDIAN(field)`
- `VALUES(field)` -- collect distinct values

### Tips

- Always specify a time range with `WHERE @timestamp > NOW() - <duration>` to avoid scanning too much data
- Use `LIMIT` to control output size
- Use `KEEP` to select specific columns before output
- Use `DROP` to exclude columns
- Use `RENAME old AS new` to rename columns
- Use `EVAL new_field = expression` to create computed columns
- Use `DISSECT` or `GROK` for parsing unstructured text fields
