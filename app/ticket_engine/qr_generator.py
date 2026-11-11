"""Only opaque random tokens enter a QR code; never personal information."""
from io import BytesIO
import secrets
import qrcode
from app.backend.authentication import digest

PREFIX = "AAST1."


def new_token():
    token = secrets.token_urlsafe(32)
    return token, digest(token)


def payload(token):
    return PREFIX + token


def qr_png(token):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
    qr.add_data(payload(token))
    qr.make(fit=True)
    output = BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(output, format="PNG")
    return output.getvalue()
