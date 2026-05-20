import {
  to = google_kms_key_ring.binary_auth
  id = "projects/casecomp-495718/locations/global/keyRings/binary-auth"
}

resource "google_kms_key_ring" "binary_auth" {
  name     = "binary-auth"
  location = "global"

  depends_on = [google_project_service.cloudkms]
}

import {
  to = google_kms_crypto_key.attestor_key
  id = "projects/casecomp-495718/locations/global/keyRings/binary-auth/cryptoKeys/attestor-key"
}

resource "google_kms_crypto_key" "attestor_key" {
  name     = "attestor-key"
  key_ring = google_kms_key_ring.binary_auth.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_P256_SHA256"
    protection_level = "SOFTWARE"
  }
}

import {
  to = google_container_analysis_note.deploy_attestor
  id = "projects/casecomp-495718/notes/deploy-attestor"
}

resource "google_container_analysis_note" "deploy_attestor" {
  name = "deploy-attestor"

  attestation_authority {
    hint {
      human_readable_name = "Deploy pipeline attestor"
    }
  }

  depends_on = [google_project_service.containeranalysis]
}

import {
  to = google_binary_authorization_attestor.deploy
  id = "projects/casecomp-495718/attestors/deploy-attestor"
}

resource "google_binary_authorization_attestor" "deploy" {
  name = "deploy-attestor"

  attestation_authority_note {
    note_reference = google_container_analysis_note.deploy_attestor.name

    public_keys {
      id = "//cloudkms.googleapis.com/v1/projects/casecomp-495718/locations/global/keyRings/binary-auth/cryptoKeys/attestor-key/cryptoKeyVersions/1"

      pkix_public_key {
        public_key_pem = <<-EOT
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEz1M4jt+Io7Na86SpMNZkIG+yUEn+
7N/9tVN7BfbH2jZ76A1zm02/5qC4oPbk/+i0SFcUuKMUCqkv+tv4hORMzA==
-----END PUBLIC KEY-----
EOT
        signature_algorithm = "ECDSA_P256_SHA256"
      }
    }
  }

  depends_on = [
    google_project_service.binaryauthorization,
    google_kms_crypto_key.attestor_key,
  ]
}

resource "google_binary_authorization_policy" "default" {
  global_policy_evaluation_mode = "ENABLE"

  default_admission_rule {
    evaluation_mode  = "ALWAYS_ALLOW"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
  }

  depends_on = [google_project_service.binaryauthorization]
}

resource "google_kms_crypto_key_iam_member" "deploy_sa_signer" {
  crypto_key_id = google_kms_crypto_key.attestor_key.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:casecomp-deploy@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "deploy_sa_note_attacher" {
  project = var.project_id
  role    = "roles/containeranalysis.notes.attacher"
  member  = "serviceAccount:casecomp-deploy@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "deploy_sa_occurrence_editor" {
  project = var.project_id
  role    = "roles/containeranalysis.occurrences.editor"
  member  = "serviceAccount:casecomp-deploy@${var.project_id}.iam.gserviceaccount.com"
}
