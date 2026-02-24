# BigQuery views for Looker Studio dashboards.
# All views query the Cloud Logging sink table `run_googleapis_com_stdout`.

locals {
  log_table = "`${var.project_id}.${google_bigquery_dataset.app_logs.dataset_id}.run_googleapis_com_stdout`"
}

# ---------- v_requests: base view flattening jsonPayload ----------

resource "google_bigquery_table" "v_requests" {
  count = var.manage_bigquery_views ? 1 : 0

  dataset_id = google_bigquery_dataset.app_logs.dataset_id
  table_id   = "v_requests"

  view {
    query = <<-SQL
      SELECT
        timestamp,
        jsonPayload.requestId   AS request_id,
        jsonPayload.userId      AS user_id,
        jsonPayload.route       AS route,
        jsonPayload.method      AS method,
        jsonPayload.action      AS action,
        CAST(jsonPayload.statusCode AS INT64)  AS status_code,
        CAST(jsonPayload.durationMs AS FLOAT64) AS duration_ms,
        severity
      FROM ${local.log_table}
      WHERE jsonPayload.logType = 'api_request'
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false

  depends_on = [google_bigquery_dataset.app_logs]
}

# ---------- v_daily_summary: DAU, request count, error rate ----------

resource "google_bigquery_table" "v_daily_summary" {
  count = var.manage_bigquery_views ? 1 : 0

  dataset_id = google_bigquery_dataset.app_logs.dataset_id
  table_id   = "v_daily_summary"

  view {
    query = <<-SQL
      SELECT
        DATE(timestamp, 'Asia/Tokyo') AS date,
        COUNT(DISTINCT jsonPayload.userId) AS dau,
        COUNT(*) AS total_requests,
        COUNTIF(CAST(jsonPayload.statusCode AS INT64) >= 400) AS error_count,
        ROUND(SAFE_DIVIDE(
          COUNTIF(CAST(jsonPayload.statusCode AS INT64) >= 400),
          COUNT(*)
        ) * 100, 2) AS error_rate_pct,
        ROUND(AVG(CAST(jsonPayload.durationMs AS FLOAT64)), 1) AS avg_duration_ms
      FROM ${local.log_table}
      WHERE jsonPayload.logType = 'api_request'
      GROUP BY date
      ORDER BY date DESC
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false

  depends_on = [google_bigquery_dataset.app_logs]
}

# ---------- v_feature_usage: route/action breakdown ----------

resource "google_bigquery_table" "v_feature_usage" {
  count = var.manage_bigquery_views ? 1 : 0

  dataset_id = google_bigquery_dataset.app_logs.dataset_id
  table_id   = "v_feature_usage"

  view {
    query = <<-SQL
      SELECT
        DATE(timestamp, 'Asia/Tokyo') AS date,
        jsonPayload.route  AS route,
        jsonPayload.action AS action,
        jsonPayload.method AS method,
        COUNT(*) AS request_count,
        COUNT(DISTINCT jsonPayload.userId) AS unique_users,
        ROUND(AVG(CAST(jsonPayload.durationMs AS FLOAT64)), 1) AS avg_duration_ms
      FROM ${local.log_table}
      WHERE jsonPayload.logType = 'api_request'
      GROUP BY date, route, action, method
      ORDER BY date DESC, request_count DESC
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false

  depends_on = [google_bigquery_dataset.app_logs]
}

# ---------- v_performance: latency percentiles per endpoint ----------

resource "google_bigquery_table" "v_performance" {
  count = var.manage_bigquery_views ? 1 : 0

  dataset_id = google_bigquery_dataset.app_logs.dataset_id
  table_id   = "v_performance"

  view {
    query = <<-SQL
      SELECT
        DATE(timestamp, 'Asia/Tokyo') AS date,
        jsonPayload.route  AS route,
        jsonPayload.action AS action,
        COUNT(*) AS request_count,
        ROUND(APPROX_QUANTILES(CAST(jsonPayload.durationMs AS FLOAT64), 100)[OFFSET(50)],  1) AS p50_ms,
        ROUND(APPROX_QUANTILES(CAST(jsonPayload.durationMs AS FLOAT64), 100)[OFFSET(90)],  1) AS p90_ms,
        ROUND(APPROX_QUANTILES(CAST(jsonPayload.durationMs AS FLOAT64), 100)[OFFSET(95)],  1) AS p95_ms,
        ROUND(APPROX_QUANTILES(CAST(jsonPayload.durationMs AS FLOAT64), 100)[OFFSET(99)],  1) AS p99_ms,
        ROUND(MAX(CAST(jsonPayload.durationMs AS FLOAT64)), 1) AS max_ms
      FROM ${local.log_table}
      WHERE jsonPayload.logType = 'api_request'
      GROUP BY date, route, action
      ORDER BY date DESC, p95_ms DESC
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false

  depends_on = [google_bigquery_dataset.app_logs]
}

# ---------- v_errors: requests with status >= 400 ----------

resource "google_bigquery_table" "v_errors" {
  count = var.manage_bigquery_views ? 1 : 0

  dataset_id = google_bigquery_dataset.app_logs.dataset_id
  table_id   = "v_errors"

  view {
    query = <<-SQL
      SELECT
        timestamp,
        jsonPayload.requestId  AS request_id,
        jsonPayload.userId     AS user_id,
        jsonPayload.route      AS route,
        jsonPayload.action     AS action,
        jsonPayload.method     AS method,
        CAST(jsonPayload.statusCode AS INT64)   AS status_code,
        CAST(jsonPayload.durationMs AS FLOAT64) AS duration_ms,
        severity
      FROM ${local.log_table}
      WHERE jsonPayload.logType = 'api_request'
        AND CAST(jsonPayload.statusCode AS INT64) >= 400
      ORDER BY timestamp DESC
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false

  depends_on = [google_bigquery_dataset.app_logs]
}
