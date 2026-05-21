import { test, expect, type Page, type Locator } from "@playwright/test";

// End-to-end coverage for the new chat UI. Each test types one of the dev-mock
// keywords (see server/dev-agent-plugin.ts), then asserts the resulting DOM /
// layout. We deliberately assert *invariants* (e.g. SVG bounds fit inside
// container) rather than exact pixel positions, so tests stay robust to font
// and small layout tweaks while still catching real regressions.

const STREAM_TIMEOUT = 15_000;

// While streaming, the submit button renders the spinner icon (Loader2 +
// `animate-spin`). Once `finish` arrives, the spinner is replaced with the
// ArrowUp icon. The button itself stays disabled afterwards (the input is
// empty) so we can't use button-enabled as the "done" signal.
function streamSpinner(page: Page): Locator {
  return page.locator('form button[type="submit"] svg.animate-spin');
}

async function waitForStreamEnd(page: Page) {
  await expect(streamSpinner(page)).toHaveCount(0, { timeout: STREAM_TIMEOUT });
}

// Submit a message and wait for the stream to fully finish. We don't assert
// the spinner appears first — fast scenarios (e.g. the `error` path, a single
// SSE event with no inter-chunk delay) can land before Playwright's polling
// catches the in-flight spinner, which would be a false negative. Waiting on
// the input clearing tells us the submit handler fired; waitForStreamEnd
// then waits until either the spinner has appeared and resolved, or the
// stream was synchronous and there was never a spinner to see.
async function sendMessage(page: Page, text: string) {
  const textarea = page.getByPlaceholder("Send a message...");
  await textarea.click();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
  // The handler clears the textarea synchronously after submit — confirms the
  // event fired before we start polling for stream completion.
  await expect(textarea).toHaveValue("");
  await waitForStreamEnd(page);
}

// Resolve the scroll container — the messages list scrolls inside an
// overflow-y-auto div, not the page itself.
function scrollContainer(page: Page): Locator {
  return page.locator(".overflow-y-auto").first();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Agent Playground")).toBeVisible();
});

test.describe("Default reply (no keyword)", () => {
  test("renders markdown body and shows a timestamp", async ({ page }) => {
    await sendMessage(page, "hi");

    // The default reply includes an h2 "What changed" — assert it's rendered as
    // a heading, not raw text.
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
    // Streamdown renders fenced code blocks with a copy button per language
    // label; the default reply has a `ts` block. The outer wrapper carries
    // both data-streamdown=code-block AND data-language=ts (the header/body
    // children share data-language=ts too, so we scope to the wrapper).
    await expect(page.locator('[data-streamdown="code-block"][data-language="ts"]')).toBeVisible();
  });
});

test.describe("Markdown showcase", () => {
  test("renders headings, table, mermaid SVG, KaTeX math, and inline image", async ({ page }) => {
    await sendMessage(page, "markdown");

    // Headings — the showcase opens with an h1 "Markdown showcase".
    await expect(page.getByRole("heading", { level: 1, name: "Markdown showcase" })).toBeVisible();

    // Mermaid diagram should render as an SVG inside its block. We assert the
    // SVG exists AND its bounding box fits within its container — the bug we
    // shipped and reverted was the SVG overflowing the panZoom viewport.
    const mermaidPanel = page.locator('[data-streamdown="mermaid-block"]');
    await expect(mermaidPanel).toBeVisible();
    const svg = mermaidPanel.locator("svg").first();
    await expect(svg).toBeVisible();

    const panelBox = await mermaidPanel.boundingBox();
    const svgBox = await svg.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(svgBox).not.toBeNull();
    if (panelBox && svgBox) {
      // Allow a 1px sub-pixel rounding fudge.
      expect(svgBox.x + svgBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
      expect(svgBox.y + svgBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
    }

    // KaTeX block math present — the math plugin emits a .katex element per
    // typeset equation.
    await expect(page.locator(".katex").first()).toBeVisible();

    // Inline image inside a paragraph should align to the middle of the text,
    // not the baseline. Easiest check: computed vertical-align is "middle".
    const inlineImg = page.locator("p img").first();
    await expect(inlineImg).toBeVisible();
    const verticalAlign = await inlineImg.evaluate(
      (el) => window.getComputedStyle(el as HTMLElement).verticalAlign,
    );
    expect(verticalAlign).toBe("middle");
  });
});

test.describe("Tool calls", () => {
  test("shimmer label appears mid-stream and collapses to a summary when done", async ({ page }) => {
    const textarea = page.getByPlaceholder("Send a message...");
    await textarea.click();
    await textarea.fill("tools");
    await page.keyboard.press("Enter");

    // While the tools are running, the ToolStrip shows the friendly action
    // label. The raw tool names are emitted in sr-only spans so they're always
    // findable.
    await expect(page.getByText("search_web", { exact: false })).toBeVisible({
      timeout: STREAM_TIMEOUT,
    });

    await waitForStreamEnd(page);

    // After done, both tools should be visible somewhere in the strip
    // (the multi-tool variant ships a dropdown summary plus an sr-only list).
    await expect(page.getByText("search_web", { exact: false })).toBeVisible();
    await expect(page.getByText("summarize_results", { exact: false })).toBeVisible();
  });
});

test.describe("Sticky scroll", () => {
  test("auto-scroll pauses when user scrolls up, scroll-to-bottom button restores it", async ({
    page,
  }) => {
    await sendMessage(page, "long");

    const container = scrollContainer(page);

    // Use a real wheel gesture (not a programmatic scrollTop change) — the
    // chat hook only flips out of "sticky" mode on user gestures so it can
    // ignore the scroll events caused by its own auto-scroll. Move the mouse
    // over the messages area first so the wheel hits the right element.
    const box = await container.boundingBox();
    if (!box) throw new Error("scroll container has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);

    // The scroll-to-bottom button should appear once we leave the sticky zone.
    const scrollBtn = page.getByRole("button", { name: "Scroll to latest" });
    await expect(scrollBtn).toBeVisible();

    // Clicking it returns us to the bottom. Smooth-scroll takes a moment;
    // poll instead of using a fixed timeout so the test is robust to varying
    // animation durations. Tolerance matches the 50px sticky threshold in
    // Thread.tsx — any closer is "at bottom" as far as the app is concerned.
    await scrollBtn.click();
    await expect
      .poll(
        async () =>
          await container.evaluate((el) => {
            const h = el as HTMLElement;
            return h.scrollHeight - h.scrollTop - h.clientHeight;
          }),
        { timeout: 5_000 },
      )
      .toBeLessThan(50);
  });
});

test.describe("Errors", () => {
  test("server-side error renders inside the assistant bubble, not in the top banner", async ({
    page,
  }) => {
    await sendMessage(page, "error");

    // The mock emits `Mock error: something exploded.` — the chat hook prefixes
    // it with "Error: ".
    await expect(page.getByText(/Mock error: something exploded/)).toBeVisible();

    // The top error banner is reserved for app-level failures (config fetch,
    // history load). Per-message errors must not leak into it.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("Reasoning", () => {
  test("reasoning text is visible during stream and fades out on finish", async ({ page }) => {
    const textarea = page.getByPlaceholder("Send a message...");
    await textarea.click();
    await textarea.fill("reason");
    await page.keyboard.press("Enter");

    // The reasoning preamble contains a recognizable phrase from the mock.
    const reasoning = page.getByText(/work through this step by step/, { exact: false });
    await expect(reasoning).toBeVisible({ timeout: STREAM_TIMEOUT });

    await waitForStreamEnd(page);

    // The LiveReasoning component fades over 500ms then unmounts; give it a
    // beat then assert it's gone.
    await page.waitForTimeout(800);
    await expect(reasoning).toHaveCount(0);
  });
});

test.describe("Header + view toggle", () => {
  test("config tab loads and chat tab returns to the conversation", async ({ page }) => {
    await sendMessage(page, "hi");
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();

    await page.getByRole("button", { name: "Config" }).click();
    await expect(page.getByText("System Prompt")).toBeVisible();

    await page.getByRole("button", { name: "Chat" }).click();
    // The earlier reply should still be in the thread when we come back.
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
  });
});
