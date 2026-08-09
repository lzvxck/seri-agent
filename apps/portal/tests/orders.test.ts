import { describe, expect, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import { invoiceUrl, listOrders } from "../lib/orders";

function polarError(statusCode: number) {
  return Object.assign(new Error(`polar responded ${statusCode}`), { statusCode });
}

const noWait = async () => {};

describe("listOrders", () => {
  test("collects items across every page the async iterator yields", async () => {
    const pages = [
      { result: { items: [{ id: "order_1" }] } },
      { result: { items: [{ id: "order_2" }] } },
    ];
    const client = {
      orders: {
        list: () =>
          Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              for (const page of pages) yield page;
            },
          }),
      },
    };

    const orders = await listOrders(client as unknown as Polar, "user_1");

    expect(orders.map((o) => o.id)).toEqual(["order_1", "order_2"]);
  });
});

describe("invoiceUrl", () => {
  function fakePolar(invoiceResponses: Array<{ url: string } | "404">) {
    let call = 0;
    const calls: string[] = [];
    const client = {
      orders: {
        generateInvoice: () => {
          calls.push("generateInvoice");
          return Promise.resolve(undefined);
        },
        invoice: () => {
          calls.push("invoice");
          const response = invoiceResponses[Math.min(call, invoiceResponses.length - 1)];
          call++;
          return response === "404" ? Promise.reject(polarError(404)) : Promise.resolve(response);
        },
      },
    };
    return { client: client as unknown as Polar, calls };
  }

  test("retries a 404 — the doc generation Polar describes as a 202 plus a few seconds — then succeeds", async () => {
    const { client, calls } = fakePolar([
      "404",
      "404",
      { url: "https://sandbox.polar.sh/invoice.pdf" },
    ]);

    const url = await invoiceUrl(client, "order_1", noWait);

    expect(url).toBe("https://sandbox.polar.sh/invoice.pdf");
    expect(calls.filter((c) => c === "invoice")).toHaveLength(3);
  });

  // The bound: one immediate attempt plus three backoff retries. A fifth 404 is never asked
  // for — this is what keeps a stuck generation from turning into an open-ended poll.
  test("gives up bounded rather than looping", async () => {
    const { client, calls } = fakePolar(["404", "404", "404", "404", "404"]);

    await expect(invoiceUrl(client, "order_1", noWait)).rejects.toThrow("polar responded 404");
    expect(calls.filter((c) => c === "invoice")).toHaveLength(4);
  });

  test("a non-404 failure propagates immediately, without retrying", async () => {
    const client = {
      orders: {
        generateInvoice: () => Promise.resolve(undefined),
        invoice: () => Promise.reject(polarError(500)),
      },
    } as unknown as Polar;

    await expect(invoiceUrl(client, "order_1", noWait)).rejects.toThrow("polar responded 500");
  });
});
