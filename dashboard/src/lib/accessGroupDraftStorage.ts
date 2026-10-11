"use client";

/** Duplicating a browser tab copies sessionStorage. Probe ownership before
 * reusing that bucket so duplicated tabs never write each other's drafts. */
export async function claimGroupDraftBucket(prefix: string) {
  const previous = sessionStorage.getItem(prefix + "tab");
  let id =
    previous && /^[a-f0-9-]{36}$/.test(previous)
      ? previous
      : crypto.randomUUID();
  const instance = crypto.randomUUID();
  let channel: BroadcastChannel | null = null;
  let collision = false;
  try {
    channel = new BroadcastChannel(prefix + "owners");
    channel.onmessage = (event) => {
      const message = event.data;
      if (!message || message.instance === instance || message.id !== id)
        return;
      if (message.kind === "probe")
        channel?.postMessage({ kind: "owner", id, instance });
      else if (message.kind === "owner") collision = true;
    };
    if (previous) {
      channel.postMessage({ kind: "probe", id, instance });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (collision) id = crypto.randomUUID();
  } catch {
    channel?.close();
    channel = null;
    // Without inter-tab communication, a new bucket per visit is safer than
    // reusing a possibly copied identity. Restore from the previous bucket.
    id = crypto.randomUUID();
  }
  try { sessionStorage.setItem(prefix + "tab", id); }
  catch (error) { channel?.close(); throw error; }
  return {
    key: prefix + id,
    restoreKey: previous ? prefix + previous : prefix + id,
    close: () => channel?.close(),
  };
}
