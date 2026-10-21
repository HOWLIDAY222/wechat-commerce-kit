import nodemailer from "nodemailer";
import { appConfig } from "@/lib/config";

export type EmailProviderStatus = {
  configured: boolean;
  provider: "disabled" | "smtp";
};

export function getEmailProviderStatus(): EmailProviderStatus {
  return {
    provider: appConfig.EMAIL_PROVIDER,
    configured:
      appConfig.EMAIL_PROVIDER === "smtp" &&
      Boolean(appConfig.SMTP_HOST && appConfig.SMTP_USER && appConfig.SMTP_PASSWORD && appConfig.SMTP_FROM),
  };
}

export async function sendTransactionalEmail(input: {
  html: string;
  subject: string;
  text: string;
  to: string;
}) {
  const status = getEmailProviderStatus();
  if (!status.configured) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");

  const transporter = nodemailer.createTransport({
    host: appConfig.SMTP_HOST,
    port: appConfig.SMTP_PORT,
    secure: appConfig.SMTP_SECURE,
    auth: {
      user: appConfig.SMTP_USER,
      pass: appConfig.SMTP_PASSWORD,
    },
  });

  const result = await transporter.sendMail({
    from: appConfig.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  return { messageId: result.messageId };
}
