import aiosmtplib
from email.message import EmailMessage

from app.config import settings


async def send_email(to: str, subject: str, html: str) -> None:
    if not settings.SMTP_HOST:
        # Dev mode: log to console instead of sending
        print(f"\n📧 EMAIL (SMTP not configured):\nTo: {to}\nSubject: {subject}\n{html}\n")
        return

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(html, subtype="html")

    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER or None,
        password=settings.SMTP_PASSWORD or None,
        start_tls=settings.SMTP_TLS,
    )


async def send_verification_email(to: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}/?verifyToken={token}"
    await send_email(
        to=to,
        subject="Verify your MyGreenPlanner email",
        html=f"""
<p>Welcome to MyGreenPlanner!</p>
<p>Please verify your email address by clicking the link below:</p>
<p><a href="{link}">{link}</a></p>
<p>This link expires in 24 hours.</p>
""",
    )


async def send_reset_email(to: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}/?resetToken={token}"
    await send_email(
        to=to,
        subject="Reset your MyGreenPlanner password",
        html=f"""
<p>You requested a password reset for your MyGreenPlanner account.</p>
<p>Click the link below to set a new password:</p>
<p><a href="{link}">{link}</a></p>
<p>This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
""",
    )
