resource "google_bigquery_dataset" "app_logs" {
  dataset_id                  = "gemihub_logs"
  friendly_name               = "GemiHub Application Logs"
  location                    = var.region
  default_table_expiration_ms = 7776000000 # 90 days

  depends_on = [google_project_service.apis]
}

resource "google_logging_project_sink" "app_logs" {
  name        = "gemihub-app-logs-to-bigquery"
  destination = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.app_logs.dataset_id}"

  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"gemini-hub\"",
    "jsonPayload.logType=\"api_request\"",
  ])

  bigquery_options {
    use_partitioned_tables = true
  }

  unique_writer_identity = true
}

resource "google_bigquery_dataset_iam_member" "log_sink_writer" {
  dataset_id = google_bigquery_dataset.app_logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.app_logs.writer_identity
}
