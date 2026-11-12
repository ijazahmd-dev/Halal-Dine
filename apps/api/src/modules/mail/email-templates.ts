export interface VerificationEmailTemplateParams {
  name: string;
  verificationUrl: string;
  expiryHours: number;
}

export interface RenderedEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderVerificationEmailTemplate(
  params: VerificationEmailTemplateParams,
): RenderedEmailTemplate {
  const safeName = escapeHtml(params.name);
  const safeUrl = escapeHtml(params.verificationUrl);

  return {
    subject: 'Verify your Halal Dine email address',
    text: [
      `Assalamu Alaikum ${params.name},`,
      '',
      'Thank you for registering with Halal Dine.',
      'Please verify your email address by visiting the link below:',
      '',
      params.verificationUrl,
      '',
      `This verification link will expire in ${params.expiryHours} hours.`,
      'If you did not create an account, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #065f46;">Verify your Halal Dine email address</h2>
        <p>Assalamu Alaikum ${safeName},</p>
        <p>Thank you for registering with <strong>Halal Dine</strong>. Please confirm your email address by clicking the button below:</p>
        <p style="margin: 24px 0;">
          <a href="${safeUrl}" style="background-color: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Verify Email Address
          </a>
        </p>
        <p style="font-size: 14px; color: #4b5563;">
          If the button does not work, copy and paste this link into your browser:<br />
          <a href="${safeUrl}">${safeUrl}</a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">
          This verification link will expire in ${params.expiryHours} hours. If you did not create an account, you can safely ignore this message.
        </p>
      </div>
    `,
  };
}

