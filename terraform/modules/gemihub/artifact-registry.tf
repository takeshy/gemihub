resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "gemini-hub"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}
