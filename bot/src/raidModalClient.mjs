/** Native Discord modals require an immediate type-9 response (they cannot be deferred).
 * Fetch the personalized form from the dashboard with a strict ACK deadline.
 * The dashboard verifies Discord's signature independently before reading user data.
 */
export async function fetchRaidSignupModal({ rawBody, signature, timestamp }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  try {
    const base = String(process.env.DASHBOARD_INTERNAL_URL || 'http://dashboard:3000').replace(/\/+$/, '');
    const response = await fetch(`${base}/api/internal/discord/raid-modal`, {
      method: 'POST', signal: controller.signal,
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${String(process.env.INTERNAL_API_TOKEN || '')}`,
        'x-mistblossom-source': 'bot', 'x-signature-ed25519': signature,
        'x-signature-timestamp': timestamp,
      }, body: rawBody,
    });
    if (!response.ok) throw new Error(`modal preparation HTTP ${response.status}`);
    const result = await response.json();
    if (result?.type !== 9 || !Array.isArray(result.data?.components) || !result.data?.custom_id) {
      throw new Error('invalid modal response');
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
