---
name: profiling
description: >
  Use this skill when analyzing CPU performance issues using Elastic Universal Profiling.
  Activate when investigating high CPU, performance degradation, or identifying hot code paths.
metadata:
  version: 0.1.0
  visibility: public
---

# Elastic Universal Profiling Analysis

## When to Use Profiling Tools

Use profiling data when:
- Investigating high CPU usage
- Identifying hot code paths and performance bottlenecks
- Analyzing performance regressions
- Comparing execution profiles across services or time periods

## Tools Overview

### `kibana_profiling_top_functions`
**Quick overview of hottest functions**

Use to identify the most CPU-intensive or frequently-called functions in your system:

```
kibana_profiling_top_functions
  limit: 20
  timestamp_gte: "2026-04-20T10:00:00"
  timestamp_lt: "2026-04-20T11:00:00"
```

Response includes function names, filenames, and sample counts. Sort mentally by sample count to find the hottest functions.

### `kibana_profiling_flamegraph`
**Deep call-path visualization**

Use to see how functions call each other and where time is being spent in the call stack:

```
kibana_profiling_flamegraph
  sample_size: 10000
  timestamp_gte: "2026-04-20T10:00:00"
  timestamp_lt: "2026-04-20T11:00:00"
  exec: "myapp"  # optional: filter by executable
```

Response is a tree of stacktraces. Wide branches = more samples. Look for:
- Deep call stacks that are called frequently
- Leaf functions with high exclusive counts
- Unusual/unexpected function calls

### `kibana_profiling_stacktraces`
**Recent raw stacktraces with full symbols**

Use to examine actual stack traces from a recent time window, filtered by process:

```
kibana_profiling_stacktraces
  last: "30 minutes"       # time window: "7 days", "2 hours", "15 minutes"
  limit: 100              # optional: limit returned traces
  comm: "worker-thread"   # optional: filter by thread name
  # OR:
  exec: "java"            # optional: filter by executable (mutually exclusive with comm)
```

Response includes symbolized frames with function names, source files, and line numbers.

## Analysis Workflow

### 1. Quick Hotspot Identification

When you notice CPU usage is high, start with top functions:

```
kibana_profiling_top_functions
  limit: 20
  timestamp_gte: "<issue start time>"
  timestamp_lt: "<issue end time>"
```

This tells you which 20 functions consumed the most CPU samples.

### 2. Understand the Call Path

Once you identify hot functions, use flamegraph to see how they're being called:

```
kibana_profiling_flamegraph
  sample_size: 50000
  timestamp_gte: "<issue start time>"
  timestamp_lt: "<issue end time>"
  exec: "<process name>"  # if known
```

Trace the path from main() through the hot functions. Look for:
- Unexpected callers of the hot function
- Excessive nesting depth
- Loops or recursion in the call path

### 3. Correlate with Code and Logs

Once you have the hot functions and their callers:
- Reference the source files and line numbers from the profiles
- Search logs for related service activity during the same time window
- Check metrics (CPU%, memory) to confirm the issue timeline

### 4. Look for Common Patterns

| Pattern | Diagnosis |
|---------|-----------|
| Single function with 50%+ samples | Algorithmic hotspot — review implementation |
| Tight loop of system calls | I/O bottleneck — check network/disk metrics |
| Deep call stack, low per-frame counts | Overhead in call chain — consider inlining |
| GC or memory allocation functions | Memory pressure — check heap metrics |

## Timestamp Format

All tools use ISO 8601 format: `"YYYY-MM-DDTHH:MM:SS"` (e.g., `"2026-04-20T14:30:00"`)

If you only have relative time (e.g., "the issue was 2 hours ago"), calculate absolute times:
- Now: use the current time in ISO format
- 2 hours ago: subtract 2 hours from now

## Tips

- **Large sample sizes (flamegraph)** give more complete data but take longer to aggregate. Start with 10000-50000.
- **Narrow time windows** reduce noise. If you know the issue window was 15 minutes, use that exactly.
- **Filter by executable/thread** to focus on a specific service or process.
- **Cross-reference with metrics** — high CPU in profiles should correlate with spikes in system.cpu metrics.
