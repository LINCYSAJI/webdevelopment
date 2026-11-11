import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Sends email through any provider's SMTP service (Amazon SES, SendGrid, Brevo, Mailgun, Zoho,
 * Microsoft 365, Google Workspace, ...). Only the connection settings differ between providers.
 * TLS is always used: implicit TLS on port 465, otherwise STARTTLS is required.
 */
export interface SmtpOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}

export interface SmtpMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export class SmtpEmail {
  private transporter: Transporter;

  constructor(private opts: SmtpOptions) {
    const implicitTls = opts.port === 465;
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: implicitTls,
      requireTLS: !implicitTls,
      auth: opts.user ? { user: opts.user, pass: opts.password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  /** Connects and logs in without sending anything: proves the host, port, TLS and login work. */
  async verify() {
    await this.transporter.verify();
  }

  async send(message: SmtpMessage) {
    await this.transporter.sendMail({
      from: this.opts.from,
      replyTo: this.opts.replyTo || undefined,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
  }
}
