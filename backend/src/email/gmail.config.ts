export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export function gmailOptions(env: NodeJS.ProcessEnv = process.env) {
  const mailbox = (env.GMAIL_MAILBOX ?? '').trim().toLowerCase();
  const from = /(?:^|<)([^<>\s]+@[^<>\s]+)>?$/.exec(env.EMAIL_FROM ?? '')?.[1]?.toLowerCase();
  if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(mailbox) ||
      /@(gmail|googlemail)\.com$/.test(mailbox) || from !== mailbox ||
      /[\r\n]/.test(env.EMAIL_FROM ?? '') || !env.GMAIL_CLIENT_ID ||
      !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN)
    throw new Error('Configure the Workspace mailbox, matching EMAIL_FROM and private Gmail OAuth credentials.');
  const perMinute = Number(env.GMAIL_MAX_PER_MINUTE ?? 20);
  const perDay = Number(env.GMAIL_MAX_PER_DAY ?? 400);
  if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 60 ||
      !Number.isInteger(perDay) || perDay < 1 || perDay > 1500)
    throw new Error('Gmail sending limits must be 1-60/minute and 1-1500/rolling day.');
  return { mailbox, perMinute, perDay, clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN };
}
