// The raw OpenAI-compatible /chat/completions `usage` object OpenRouter forwards verbatim:
// standard prompt_tokens/completion_tokens plus OpenRouter's own `cost` extension and OpenAI's
// cached-token convention for cache reads.
export type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

const TAIL_BYTES = 8192;

// Parses the final `data:` frame carrying `usage` out of an OpenAI-compatible SSE stream's
// tail. Every chunk is enqueued to the real response BEFORE this ever inspects anything, so a
// parse failure here can only lose a usage row — never corrupt what the caller receives.
function parseFinalUsage(tail: string): unknown {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line?.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.usage) return parsed.usage;
    } catch {
      // Keep scanning older frames — a truncated or malformed frame is not fatal.
    }
  }
  return undefined;
}

// Exported so a test can feed it a truncated tail directly, matching this module's
// test-the-exports convention.
export function createUsageTap(
  onUsage: (usage: unknown) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  // Concatenating + re-slicing on every chunk is O(buffered length) work per chunk for an
  // O(TAIL_BYTES) result — buffered here and only collapsed once the backlog grows to twice
  // what's needed, so a stream of many small chunks doesn't pay that cost on each one.
  let chunks: string[] = [];
  let length = 0;
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const decoded = decoder.decode(chunk, { stream: true });
      chunks.push(decoded);
      length += decoded.length;
      if (length > TAIL_BYTES * 2) {
        const trimmed = chunks.join("").slice(-TAIL_BYTES);
        chunks = [trimmed];
        length = trimmed.length;
      }
    },
    flush() {
      const usage = parseFinalUsage(chunks.join("").slice(-TAIL_BYTES));
      if (usage !== undefined) onUsage(usage);
    },
  });
}

// `fetch` transparently decompresses a gzip'd upstream body but leaves Content-Encoding and the
// original (compressed) Content-Length on the Headers object it hands back — forwarding those
// verbatim alongside an already-decompressed (or, on the non-streaming path, re-serialized)
// body is a real mismatch that can break the caller's decode. Stripped here rather than
// negotiated away with our own Accept-Encoding, since the non-streaming path re-serializes the
// JSON body regardless of whether OpenRouter compressed the original response.
export function forwardableHeaders(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete("content-encoding");
  copy.delete("content-length");
  return copy;
}
