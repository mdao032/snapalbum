import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

/** NF-030: every page checked by an end-to-end test must have no detectable WCAG A/AA issue. */
export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** NF-022: no horizontal scroll, whatever the screen width. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Local Supabase test inbox (Mailpit): sign-in e-mails never leave the machine. */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export function uniqueEmail(): string {
  return `orga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

interface MailpitMessage {
  ID: string;
  Subject: string;
}

/** The newest e-mail sent to `address`: its subject, HTML and the sign-in link it contains. */
export async function waitForSignInEmail(
  address: string,
): Promise<{ subject: string; html: string; link: URL }> {
  const search = `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`;
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        const reply = await fetch(search);
        const body = (await reply.json()) as { messages?: MailpitMessage[] };
        found = body.messages?.[0];
        return found?.ID;
      },
      { message: `no e-mail received for ${address}`, timeout: 20_000 },
    )
    .toBeTruthy();

  const message = (await (await fetch(`${MAILPIT}/api/v1/message/${found?.ID}`)).json()) as {
    HTML: string;
    Subject: string;
  };
  const href = /href="([^"]*token_hash=[^"]*)"/.exec(message.HTML)?.[1];
  if (!href) throw new Error(`no sign-in link in the e-mail:\n${message.HTML}`);
  return {
    subject: message.Subject,
    html: message.HTML,
    link: new URL(href.replaceAll("&amp;", "&")),
  };
}

/**
 * The link in the e-mail points at NEXT_PUBLIC_SITE_URL (port 3000); the tests serve the app on
 * their own port, so keep the path and query and use the test server's origin.
 */
export function linkOnTestServer(link: URL, baseURL: string | undefined): string {
  return new URL(`${link.pathname}${link.search}`, baseURL).toString();
}

function randomIp(): string {
  const part = () => Math.floor(Math.random() * 250) + 1;
  return `198.51.${part()}.${part()}`;
}

/**
 * Each test signs in from its own fake IP address, so the sign-in limit (S-003, 5 per 15 minutes
 * per address) does not make unrelated tests fail.
 */
export const test = base.extend({
  page: async ({ page }, run) => {
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await run(page);
  },
});

export { expect };
