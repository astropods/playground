import { test, expect, type Page } from "@playwright/test";

// End-to-end coverage for the file-attachment flow:
//   - Paperclip opens the modal
//   - File picker attaches a text or binary file
//   - Pill renders above the textarea with name + size and an X to remove
//   - Submit POSTs `files` and the dev plugin echoes back what it received,
//     so we can verify the wire format round-trip from the browser
//   - Chip shows inside the user bubble after sending
//
// We rely on the dev-agent-plugin (server/dev-agent-plugin.ts) to ack any
// attached files as the first chunk of the assistant reply — that's our
// observable "the server received the file" signal in the UI.

const STREAM_TIMEOUT = 15_000;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Agent Playground")).toBeVisible();
});

// Pick a file from disk via the hidden <input type="file">. Setting the input
// directly is more reliable than driving the OS file picker, which Playwright
// can't see.
async function attachFile(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await page.getByRole("button", { name: "Attach file" }).click();
  // The dialog renders inside a Radix portal; the input is hidden but in the DOM.
  const input = page.locator('input[type="file"]');
  await expect(input).toBeAttached();
  await input.setInputFiles(files);
}

test.describe("File attachments", () => {
  test("attach a text file, send, and verify the server saw it", async ({ page }) => {
    await attachFile(page, [
      {
        name: "hello.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello, world"),
      },
    ]);

    // Pill in the compose area: filename + size + remove button.
    await expect(page.getByText("hello.txt").first()).toBeVisible();
    await expect(page.getByText("12 B")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /remove hello.txt/i }),
    ).toBeVisible();

    // Send with no text — file alone should be enough to enable submit.
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Dev plugin acknowledgement names the file, MIME type, and text encoding.
    // (The filename itself appears twice — once in the user-bubble chip, once
    // in the streamed assistant ack — so we assert on the MIME-encoding tail,
    // which is unique to the ack.)
    await expect(
      page.getByText(/Received 1 attachment/i),
    ).toBeVisible({ timeout: STREAM_TIMEOUT });
    await expect(page.getByText(/text\/plain, text, 12 chars/)).toBeVisible();

    // After send, the in-bubble chip still shows the filename; the compose
    // pill (with the remove button) is gone.
    await expect(
      page.getByRole("button", { name: /remove hello.txt/i }),
    ).toHaveCount(0);
  });

  test("attach a binary file — server reports base64 encoding", async ({ page }) => {
    // A tiny PNG (literally bytes "PNG\0").
    const bytes = Buffer.from([0x50, 0x4e, 0x47, 0x00]);
    await attachFile(page, [
      { name: "icon.png", mimeType: "image/png", buffer: bytes },
    ]);

    await expect(page.getByText("icon.png").first()).toBeVisible();
    await page.locator('form button[type="submit"]').click();

    // Dev plugin ack should call out base64.
    await expect(
      page.getByText(/icon\.png/),
    ).toBeVisible({ timeout: STREAM_TIMEOUT });
    await expect(page.getByText(/image\/png, base64/)).toBeVisible();
  });

  test("X on the pill removes the attachment", async ({ page }) => {
    await attachFile(page, [
      { name: "drop.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
    ]);
    const remove = page.getByRole("button", { name: /remove drop.txt/i });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toHaveCount(0);

    // With nothing attached and empty text, submit is disabled.
    await expect(page.locator('form button[type="submit"]')).toBeDisabled();
  });

  test("multiple files attach in one pick and send together", async ({ page }) => {
    await attachFile(page, [
      { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
      { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("bb") },
    ]);

    await expect(page.getByText("one.txt").first()).toBeVisible();
    await expect(page.getByText("two.txt").first()).toBeVisible();

    await page.locator('form button[type="submit"]').click();
    await expect(
      page.getByText(/Received 2 attachments/i),
    ).toBeVisible({ timeout: STREAM_TIMEOUT });
  });

  test("paperclip stays enabled after attaching so more files can be added", async ({
    page,
  }) => {
    await attachFile(page, [
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    ]);
    const paperclip = page.getByRole("button", { name: "Attach file" });
    await expect(paperclip).toBeEnabled();

    // Open again and add a second file. Both pills should be visible.
    await paperclip.click();
    await page
      .locator('input[type="file"]')
      .setInputFiles([
        { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
      ]);

    await expect(page.getByText("first.txt").first()).toBeVisible();
    await expect(page.getByText("second.txt").first()).toBeVisible();
  });
});
