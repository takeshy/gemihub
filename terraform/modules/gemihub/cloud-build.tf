# Cloud Build trigger for auto-deploy on push to main.
# NOTE:
# - This project uses a 2nd-gen Cloud Build repository link.
# - The GitHub connection/repository is created manually in Cloud Console
#   (OAuth flow required), then referenced below.
#
# resource "google_cloudbuild_trigger" "deploy" {
#   name     = "gemini-hub-deploy"
#   location = var.region
#
#   repository_event_config {
#     repository = "projects/${var.project_id}/locations/${var.region}/connections/<connection-id>/repositories/<repo-id>"
#     push {
#       branch = "^main$"
#     }
#   }
#
#   filename = "cloudbuild.yaml"
#
#   substitutions = {
#     _REGION     = var.region
#     _PROJECT_ID = var.project_id
#     _SERVICE    = "gemini-hub"
#     _REPO       = "gemini-hub"
#   }
#
#   depends_on = [google_project_service.apis]
# }
