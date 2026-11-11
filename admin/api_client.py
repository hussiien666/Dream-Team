"""Thin HTTP transport only. No database, permissions or ticket logic."""
import os
import requests


class APIError(Exception):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


class Client:
    def __init__(self, token=None, base_url=None):
        self.token = token
        self.base_url = (base_url or os.getenv("NODE_API_URL", "http://127.0.0.1:3000/api/v1")).rstrip("/")

    def request(self, method, path, data=None):
        if path.startswith(("http:", "https:")) or ".." in path:
            raise ValueError("Use a relative API path.")
        try:
            response = requests.request(method, self.base_url + "/" + path.lstrip("/"),
                json=data, headers={"Authorization": "Bearer " + self.token} if self.token else {}, timeout=(5, 25), allow_redirects=False)
        except requests.RequestException:
            raise APIError("The Node API is unavailable. Start the backend and check NODE_API_URL.") from None
        if response.status_code == 204:
            return None
        try:
            value = response.json()
        except ValueError:
            raise APIError("The API returned an unreadable response.", response.status_code) from None
        if not 200 <= response.status_code < 300:
            raise APIError(value.get("message", "The request could not be completed."), response.status_code)
        return value

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, data=None):
        return self.request("POST", path, data or {})
