"""Decode camera snapshots without writing uploaded images to disk."""
from io import BytesIO
import zxingcpp
from PIL import Image, ImageOps, UnidentifiedImageError
from app.backend.authentication import AppError


def decode_qr(content):
    if len(content) > 10 * 1024 * 1024:
        raise AppError("The image exceeds 10 MB. Take a smaller picture.")
    try:
        with Image.open(BytesIO(content)) as image:
            if image.width * image.height > 20_000_000:
                raise AppError("The image is too large. Use a smaller photo.")
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((2000, 2000))
            result = zxingcpp.read_barcode(image, formats=zxingcpp.BarcodeFormat.QRCode,
                                          try_rotate=True, try_downscale=True)
            if result is None:
                result = zxingcpp.read_barcode(ImageOps.invert(image), formats=zxingcpp.BarcodeFormat.QRCode,
                                              try_rotate=True, try_downscale=True)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise AppError("The camera image could not be read.") from None
    if not result:
        raise AppError("No readable QR code. Hold the ticket steady, include the white border and take another photo.")
    return result.text
