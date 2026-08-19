# Firestore indexes required by the organization (Business) features.
#
# Invitation URLs (/invite/:token) resolve a token without knowing the parent
# organization, so `findInviteByToken` runs a collection-group query over every
# organizations/*/invites subcollection. Firestore rejects that query unless the
# `token` field carries an explicit COLLECTION_GROUP index.
#
# The database itself is NOT managed here: self-hosted installs may run without
# Firestore at all, and existing deployments already own their database.
resource "google_firestore_field" "invites_token_collection_group" {
  count = var.manage_firestore_indexes ? 1 : 0

  project    = var.project_id
  database   = var.firestore_database_id
  collection = "invites"
  field      = "token"

  index_config {
    indexes {
      order       = "ASCENDING"
      query_scope = "COLLECTION"
    }
    indexes {
      order       = "ASCENDING"
      query_scope = "COLLECTION_GROUP"
    }
  }

  depends_on = [google_project_service.apis]
}
