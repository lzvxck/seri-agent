import { describe, expect, test } from "bun:test";
import { createUsageTap } from "../lib/streamUsage";

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("createUsageTap", () => {
  // The plan's own stated tradeoff: the transform enqueues every chunk before it inspects
  // anything, so a truncated/malformed tail can only lose a usage row, never corrupt what the
  // caller receives.
  test("a truncated final usage frame is not written, and the passthrough is byte-identical", async () => {
    const encoder = new TextEncoder();
    const goodChunk = 'data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}\n\n';
    // Cut off mid-object — JSON.parse on this always throws.
    const truncatedUsageChunk = 'data: {"id":"2","choices":[],"usage":{"prompt_tok';
    const inputChunks = [encoder.encode(goodChunk), encoder.encode(truncatedUsageChunk)];

    let usageCalls = 0;
    const tap = createUsageTap(() => {
      usageCalls++;
    });
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of inputChunks) controller.enqueue(chunk);
        controller.close();
      },
    });

    const output: Uint8Array[] = [];
    const reader = source.pipeThrough(tap).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) output.push(value);
    }

    expect(new TextDecoder().decode(concatChunks(output))).toBe(goodChunk + truncatedUsageChunk);
    expect(usageCalls).toBe(0);
  });
});
