import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { createTransport } from "nodemailer";

interface SeedEmail {
  from: string;
  subject: string;
  body: string;
  category_hint: string;
}

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function loadSeedEmails(): SeedEmail[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "seed-emails");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

function parseCount(): number {
  const idx = process.argv.indexOf("--count");
  if (idx === -1) return Infinity;
  const val = process.argv[idx + 1];
  if (!val) throw new Error("Missing value for --count. Usage: npm run seed -- --count 10");
  const n = parseInt(val, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --count value: ${val}`);
  return n;
}

async function main() {
  const limit = parseCount();
  const emails = loadSeedEmails();
  const toSend = emails.slice(0, limit);

  const gmailUser = env("GMAIL_USER");
  const transport = createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: gmailUser,
      pass: env("GMAIL_APP_PASSWORD"),
    },
  });

  console.log(`[seed] Sending ${toSend.length} emails to ${gmailUser}...`);

  for (let i = 0; i < toSend.length; i++) {
    const email = toSend[i];
    await transport.sendMail({
      from: `"${email.from}" <${gmailUser}>`,
      to: gmailUser,
      subject: email.subject,
      text: email.body,
      replyTo: email.from,
    });

    console.log(`[seed] Sent ${i + 1}/${toSend.length}: ${email.subject}`);

    if (i < toSend.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  transport.close();
  console.log("[seed] Done.");
}

main().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});
