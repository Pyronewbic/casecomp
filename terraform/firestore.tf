resource "google_firestore_database" "default" {
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "PESSIMISTIC"
  delete_protection_state = "DELETE_PROTECTION_DISABLED"

  depends_on = [google_project_service.firestore]
}

locals {
  composite_indexes = {
    "api-keys_ownerId_createdAt" = {
      collection = "api-keys"
      fields = [
        { field_path = "ownerId", order = "ASCENDING" },
        { field_path = "createdAt", order = "DESCENDING" },
      ]
    }
    "grade-logs_userId_createdAt" = {
      collection = "grade-logs"
      fields = [
        { field_path = "userId", order = "ASCENDING" },
        { field_path = "createdAt", order = "DESCENDING" },
      ]
    }
    "grade-logs_source_createdAt" = {
      collection = "grade-logs"
      fields = [
        { field_path = "source", order = "ASCENDING" },
        { field_path = "createdAt", order = "DESCENDING" },
      ]
    }
    "api-analytics_userId_ts" = {
      collection = "api-analytics"
      fields = [
        { field_path = "userId", order = "ASCENDING" },
        { field_path = "ts", order = "DESCENDING" },
      ]
    }
    "price-history_cardKey_recordedAt" = {
      collection = "price-history"
      fields = [
        { field_path = "cardKey", order = "ASCENDING" },
        { field_path = "recordedAt", order = "DESCENDING" },
      ]
    }
    "price-history_cardId_recordedAt" = {
      collection = "price-history"
      fields = [
        { field_path = "cardId", order = "ASCENDING" },
        { field_path = "recordedAt", order = "DESCENDING" },
      ]
    }
  }
}

import {
  for_each = {
    "api-keys_ownerId_createdAt"       = "projects/casecomp-495718/databases/(default)/collectionGroups/api-keys/indexes/CICAgJiUpoMK"
    "grade-logs_userId_createdAt"      = "projects/casecomp-495718/databases/(default)/collectionGroups/grade-logs/indexes/CICAgJim14AK"
    "grade-logs_source_createdAt"      = "projects/casecomp-495718/databases/(default)/collectionGroups/grade-logs/indexes/CICAgJj7z4EJ"
    "api-analytics_userId_ts"          = "projects/casecomp-495718/databases/(default)/collectionGroups/api-analytics/indexes/CICAgJjF9oIK"
    "price-history_cardKey_recordedAt" = "projects/casecomp-495718/databases/(default)/collectionGroups/price-history/indexes/CICAgOjXh4EK"
  }
  to = google_firestore_index.composite[each.key]
  id = each.value
}

resource "google_firestore_index" "composite" {
  for_each   = local.composite_indexes
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = each.value.collection

  dynamic "fields" {
    for_each = each.value.fields
    content {
      field_path = fields.value.field_path
      order      = fields.value.order
    }
  }
}
