"""Future signed wallet providers plug in here; no unsigned pass generation."""
from typing import Protocol
from app.backend.authentication import AppError


class WalletProvider(Protocol):
    def is_configured(self) -> bool: ...
    def generate_signed_pass(self, ticket_data: dict) -> bytes: ...


def wallet_status():
    return "Disabled — official signing credentials and a signed-pass provider are not configured. PDF and mobile HTML tickets are available."


def generate_wallet_pass(ticket_data, provider: WalletProvider | None = None):
    if provider is None or not provider.is_configured():
        raise AppError("Wallet integration is disabled. Use the PDF or mobile web ticket.")
    return provider.generate_signed_pass(ticket_data)
