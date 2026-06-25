import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function normalizePrivateKey(value?: string) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

export function hasFirebaseProfileConfig() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
}

export function getFirebaseAdminDb() {
  if (!hasFirebaseProfileConfig()) {
    throw new Error("Profile storage is not configured.");
  }

  const app = getApps()[0] || initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });

  return getFirestore(app);
}
