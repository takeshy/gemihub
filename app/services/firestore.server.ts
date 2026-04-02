import { Firestore } from "@google-cloud/firestore";

let _firestore: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!_firestore) {
    _firestore = new Firestore();
  }
  return _firestore;
}

// Collection names
export const HUBWORK_ACCOUNTS = "hubwork-accounts";
export const HUBWORK_MAGIC_TOKENS = "hubwork-magic-tokens";
export const HUBWORK_FORM_SUBMISSIONS = "hubwork-form-submissions";
