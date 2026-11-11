"""Thin admin-client contracts; no production API or database is touched."""
import ast
from pathlib import Path
from unittest.mock import Mock
import pytest
from streamlit.testing.v1 import AppTest
from admin.api_client import Client, APIError


def test_http_client_sends_bearer_and_handles_api_errors(monkeypatch):
    import requests
    response=Mock(status_code=200)
    response.json.return_value={"events":[]}
    transport=Mock(return_value=response)
    monkeypatch.setattr(requests,"request",transport)
    client=Client("test-token", "http://127.0.0.1:3000/api/v1")
    assert client.get("events")=={"events":[]}
    args=transport.call_args
    assert args.args[:2]==("GET","http://127.0.0.1:3000/api/v1/events")
    assert args.kwargs["headers"]=={"Authorization":"Bearer test-token"}
    assert args.kwargs["allow_redirects"] is False
    response.status_code=403
    response.json.return_value={"message":"Not assigned to this event."}
    with pytest.raises(APIError,match="Not assigned"):
        client.get("events/99")
    with pytest.raises(ValueError):
        client.get("https://another-host.example/private")


def test_admin_frontend_does_not_import_database_or_backend_services():
    for source in Path("admin").glob("*.py"):
        tree=ast.parse(source.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node,ast.ImportFrom):
                assert not (node.module or "").startswith(("app.backend","sqlalchemy","sqlite3","psycopg","app.ticket_engine"))
            elif isinstance(node,ast.Import):
                assert all(not item.name.startswith(("sqlalchemy","sqlite3","psycopg")) for item in node.names)


def test_admin_requires_api_factor_before_loading_events(monkeypatch):
    calls=[]
    def fake(self,method,path,data=None):
        calls.append((method,path))
        if path=="auth/login":
            return {"accessToken":"test-token","requiresFactor":True,"requiresPasswordChange":False,"enrolled":True}
        if path=="auth/factor/verify":
            assert data=={"code":"123456"}
            return {"verified":True}
        if path=="auth/me":
            return {"user":{"displayName":"Super admin"},"sections":["Events","Event Dashboard"]}
        if path=="events":
            return [{"id":7,"name":"API event","eventDate":"2030-06-01","venue":"Main hall","status":"Published"}]
        raise AssertionError(path)
    monkeypatch.setattr(Client,"request",fake)
    app=AppTest.from_file("admin/main.py",default_timeout=20).run()
    next(w for w in app.text_input if w.label=="Username").set_value("legacy_admin")
    next(w for w in app.text_input if w.label=="Password").set_value("legacy-test-password")
    next(w for w in app.button if w.label=="Sign in").click().run()
    assert not app.exception
    assert not any(path=="events" for _,path in calls)
    next(w for w in app.text_input if w.label=="Authenticator or recovery code").set_value("123456")
    next(w for w in app.button if w.label=="Verify").click().run()
    assert not app.exception
    assert any(path=="events" for _,path in calls)
    assert app.dataframe[0].value.iloc[0]["Event"]=="API event"
