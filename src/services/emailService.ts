import nodemailer from "nodemailer";

export type SendForwardOptions = {
  articleUrl: string;
  articleTitle: string;
  source: string;
  topic: string;
  discordMessageLink: string;
};

export type SendForwardResult = {
  success: boolean;
  recipient: string;
  error?: string;
  previewUrl?: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedFrom: string = "";

// Helper to reset transporter (useful for testing)
export function resetCachedTransporter(): void {
  cachedTransporter = null;
  cachedFrom = "";
}

async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; from: string }> {
  if (cachedTransporter) {
    return { transporter: cachedTransporter, from: cachedFrom };
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "news-bot@localhost";

  if (host) {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    cachedTransporter = transporter;
    cachedFrom = from;
    return { transporter, from };
  }

  const allowFallback = process.env.ALLOW_ETHEREAL_FALLBACK === "true";

  if (process.env.NODE_ENV !== "production" || allowFallback) {
    console.log("No SMTP_HOST configured. Generating Ethereal test account...");
    try {
      const testAccount = await nodemailer.createTestAccount();
      const transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      cachedTransporter = transporter;
      cachedFrom = testAccount.user;
      console.log(`Generated Ethereal SMTP account: ${testAccount.user}`);
      return { transporter, from: testAccount.user };
    } catch (err: any) {
      throw new Error(`Failed to create Ethereal test account: ${err.message}`);
    }
  }

  throw new Error("SMTP is not configured and cannot fall back to Ethereal in production mode.");
}

export async function sendForward(options: SendForwardOptions): Promise<SendForwardResult> {
  const recipient = process.env.FORWARD_DESTINATION_EMAIL;
  if (!recipient) {
    return {
      success: false,
      recipient: "",
      error: "FORWARD_DESTINATION_EMAIL is not configured in environment variables.",
    };
  }

  try {
    const { transporter, from } = await getTransporter();

    const subject = `[News Forward] ${options.articleTitle}`;
    
    const text = `You have forwarded an article from the Discord News Bot.

Title: ${options.articleTitle}
Source: ${options.source}
Topic: ${options.topic}
Article Link: ${options.articleUrl}
Discord Message Link: ${options.discordMessageLink}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-top: 0;">News Bot Forward</h2>
        <p style="font-size: 16px; font-weight: bold; color: #34495e; margin-bottom: 20px;">${options.articleTitle}</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; width: 120px; color: #7f8c8d;">Source:</td>
            <td style="padding: 8px 0; color: #2c3e50;">${options.source}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #7f8c8d;">Topic:</td>
            <td style="padding: 8px 0; color: #2c3e50;">${options.topic}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #7f8c8d;">Article Link:</td>
            <td style="padding: 8px 0;"><a href="${options.articleUrl}" target="_blank" style="color: #3498db; text-decoration: none;">${options.articleUrl}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #7f8c8d;">Discord Post:</td>
            <td style="padding: 8px 0;"><a href="${options.discordMessageLink}" target="_blank" style="color: #3498db; text-decoration: none;">Go to Message</a></td>
          </tr>
        </table>
        <footer style="font-size: 12px; color: #95a5a6; border-top: 1px solid #e0e0e0; padding-top: 10px; text-align: center;">
          Sent by news-bot.
        </footer>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to: recipient,
      subject,
      text,
      html,
    });

    const isEthereal = from.endsWith("@ethereal.email");
    const previewUrl = isEthereal ? nodemailer.getTestMessageUrl(info) || undefined : undefined;

    if (previewUrl) {
      console.log(`📧 [Ethereal Email Preview]: ${previewUrl}`);
    }

    return {
      success: true,
      recipient,
      previewUrl,
    };
  } catch (err: any) {
    console.error("Failed to send forwarding email:", err);
    return {
      success: false,
      recipient,
      error: err.message,
    };
  }
}
