import "server-only";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";
import { publicationRevision, type PublicationOperation } from "@/lib/discordPublication";
import { buildPublicationStatus, unknownPublicationStatus } from "@/lib/publicationStatus";

/** Fresh local reads only. Receipt payload, nonce and raw Discord errors never leave the server. */
export async function readPublicationStatus(kind: "raid" | "poll", id: string) {
  try {
    const db = getFirebaseAdminDb();
    return await db.runTransaction(async tx => {
      // Resource + receipts share a transaction snapshot; avoid a transient
      // "unpublished" decision across a concurrent publication commit.
      const resource = await tx.get(db.collection(kind === "raid" ? "dashboardRaids" : "dashboardRaidPolls").doc(id));
      if (!resource.exists) return null;
      const message = await tx.get(db.collection("discordPublications").doc(publicationRevision([kind === "raid" ? "raid-message" : "poll-message", id])));
      const event = kind === "raid" ? await tx.get(db.collection("discordPublications").doc(publicationRevision(["raid-event", id]))) : null;
      return buildPublicationStatus(kind, resource.data() || {}, message.data() as PublicationOperation | undefined, event?.data() as PublicationOperation | undefined);
    });
  } catch { return unknownPublicationStatus(); }
}
