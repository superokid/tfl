/**
 * Crawlers, AI scrapers and scripted clients, by user agent. Only polite bots say who they are; this keeps
 * them off the API (and the TfL key's budget). robots.txt and X-Robots-Tag cover the static site.
 * "bot" needs a following / ; ) or space-free end so phone brands like "CUBOT X30" pass.
 */
const BOT_UA =
  /bot[/;)]|bot$|crawl|spider|slurp|-google|google-|googleother|bytespider|facebookexternalhit|python-requests|scrapy|go-http-client|okhttp/i;

export function isBot(userAgent: string | null): boolean {
  return userAgent !== null && BOT_UA.test(userAgent);
}
