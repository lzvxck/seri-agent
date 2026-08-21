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

  // The buffer batches its concat+slice instead of doing it on every chunk, so this exercises
  // both the mid-stream trim (filler exceeds 2x TAIL_BYTES) and a chunk boundary that straddles
  // the eventual TAIL_BYTES trim point — the final usage frame must still come through intact.
  test("extracts the final usage frame across many small chunks, including one straddling the trim boundary", async () => {
    const fillerFrame = 'data: {"id":"f","choices":[{"delta":{"content":"x"}}]}\n\n';
    const filler = fillerFrame.repeat(Math.ceil(20_000 / fillerFrame.length));
    const usageFrame =
      'data: {"id":"3","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.001}}\n\ndata: [DONE]\n\n';
    const full = filler + usageFrame;

    const encoder = new TextEncoder();
    const chunkSize = 37;
    const inputChunks: Uint8Array[] = [];
    for (let i = 0; i < full.length; i += chunkSize) {
      inputChunks.push(encoder.encode(full.slice(i, i + chunkSize)));
    }

    let received: unknown;
    const tap = createUsageTap((usage) => {
      received = usage;
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

    expect(new TextDecoder().decode(concatChunks(output))).toBe(full);
    expect(received).toEqual({ prompt_tokens: 10, completion_tokens: 5, cost: 0.001 });
  });
});
