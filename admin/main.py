"""Migration preview: Streamlit frontend communicating exclusively with Node."""
from pathlib import Path
import sys
import base64
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from admin.api_client import Client, APIError

st.set_page_config(page_title="Dream Events Administration", layout="wide")
st.title("Dream Events")
st.caption("Node API administration · Migration preview. The legacy app remains available until full cutover.")


def login():
    if not st.session_state.get("node_token"):
        with st.form("node_login"):
            username = st.text_input("Username", max_chars=80)
            password = st.text_input("Password", type="password", max_chars=256)
            submitted = st.form_submit_button("Sign in", type="primary")
        if submitted:
            result = Client().post("auth/login", {"username": username, "password": password})
            st.session_state.node_token = result["accessToken"]
            st.session_state.node_pending = result
            st.rerun()
        st.stop()
    client = Client(st.session_state.node_token)
    pending = st.session_state.get("node_pending", {})
    if pending.get("requiresPasswordChange"):
        with st.form("node_password"):
            current = st.text_input("Temporary password", type="password", max_chars=256)
            password = st.text_input("New password (12+ characters)", type="password", max_chars=256)
            submitted = st.form_submit_button("Change password")
        if submitted:
            client.post("auth/change-password", {"currentPassword": current, "newPassword": password})
            st.session_state.clear()
            st.rerun()
        st.stop()
    if codes := st.session_state.get("node_recovery"):
        st.warning("Save these recovery codes privately. They are displayed only here and work once each.")
        st.code("\n".join(codes))
        if st.button("I saved my recovery codes"):
            st.session_state.pop("node_recovery", None)
            st.rerun()
        st.stop()
    if pending.get("requiresFactor"):
        st.subheader("Super Admin verification")
        if not pending.get("enrolled"):
            if st.button("Set up authenticator"):
                st.session_state.node_enrollment = client.post("auth/totp/begin")
            if item := st.session_state.get("node_enrollment"):
                st.image(base64.b64decode(item["qrPng"]), width=230)
                st.code(item["secret"])
                with st.form("node_enroll"):
                    code = st.text_input("Authenticator code", max_chars=6)
                    submitted = st.form_submit_button("Enable authenticator")
                if submitted:
                    result = client.post("auth/totp/finish", {"code": code})
                    st.session_state.node_recovery = result["recoveryCodes"]
                    st.session_state.node_pending = {}
                    st.session_state.pop("node_enrollment", None)
                    st.rerun()
        else:
            with st.form("node_factor"):
                code = st.text_input("Authenticator or recovery code", max_chars=32)
                submitted = st.form_submit_button("Verify")
            if submitted:
                client.post("auth/factor/verify", {"code": code})
                st.session_state.node_pending = {}
                st.rerun()
        st.stop()
    return client, client.get("auth/me")


def access(client, event, events):
    users = client.get("users")
    st.subheader("Scanner staff")
    st.dataframe([{"ID": u["id"], "Name": u["displayName"], "Role": u["organizationUser"]["role"], "Active": u["active"]} for u in users], hide_index=True)
    with st.expander("Add scanner account"):
        with st.form("node_new_scanner"):
            username = st.text_input("New username", max_chars=80)
            name = st.text_input("Display name", max_chars=160)
            password = st.text_input("Initial scanner password", type="password", max_chars=256)
            save = st.form_submit_button("Create scanner and assign event")
        if save:
            user = client.post("users", {"username": username, "displayName": name, "password": password, "orgRole": "scanner"})
            client.post(f"users/{user['id']}/events/{event['id']}/assign")
            st.success("Scanner created and assigned. Create an entrance code below.")
    staff = [u for u in users if u["organizationUser"]["role"] == "scanner"]
    if staff:
        user_id = st.selectbox("Scanner account", [u["id"] for u in staff], format_func=lambda i: next(u["displayName"] for u in staff if u["id"] == i))
        if st.button("Assign selected scanner to this event"):
            client.post(f"users/{user_id}/events/{event['id']}/assign")
            st.success("Assignment saved.")
        if st.checkbox("Confirm remote logout for selected scanner") and st.button("Log scanner out"):
            client.post(f"scanner/users/{user_id}/remote-logout")
            st.success("Scanner session terminated.")
    st.subheader("Event access codes")
    codes = client.get(f"events/{event['id']}/access-codes")
    st.dataframe(codes, hide_index=True)
    entrances = [e for e in event.get("entrances", []) if e["active"]]
    with st.form("node_create_code"):
        name = st.text_input("Code name", max_chars=120)
        entrance_ids = st.multiselect("Permitted entrances", [e["id"] for e in entrances], format_func=lambda i: next(e["name"] for e in entrances if e["id"] == i))
        staff_ids = st.multiselect("Assigned scanner accounts", [u["id"] for u in staff], format_func=lambda i: next(u["displayName"] for u in staff if u["id"] == i))
        save = st.form_submit_button("Create access code")
    if save:
        result = client.post(f"events/{event['id']}/access-codes", {"name": name, "entranceIds": entrance_ids, "staffIds": staff_ids})
        st.warning("Share this code privately with the selected staff. It will not be displayed again.")
        st.code(result["code"])
    active = [c for c in codes if c["active"]]
    if active:
        code_id = st.selectbox("Code to deactivate", [c["id"] for c in active], format_func=lambda i: next(c["name"] for c in active if c["id"] == i))
        confirmed = st.checkbox("Deactivate this code and terminate its scanner sessions")
        if st.button("Deactivate code", disabled=not confirmed):
            result = client.post(f"events/{event['id']}/access-codes/{code_id}/deactivate")
            st.success(f"Code deactivated. {result['terminated']} scanner session(s) terminated.")


try:
    client, identity = login()
    with st.sidebar:
        st.write(identity["user"]["displayName"])
        sections = identity["sections"]
        section = st.radio("Navigation", sections)
        if st.button("Sign out"):
            client.post("auth/logout")
            st.session_state.clear()
            st.rerun()
    events = client.get("events")
    st.header(section)
    if section == "Account security":
        if st.checkbox("Replace all recovery codes") and st.button("Generate recovery codes"):
            st.session_state.node_recovery = client.post("auth/recovery/regenerate")["recoveryCodes"]
            st.rerun()
    elif not events:
        st.info("No events are available through the Node API yet. Import the legacy database into a separate PostgreSQL target first.")
    else:
        selected = st.selectbox("Event", [e["id"] for e in events], format_func=lambda i: next(e["name"] for e in events if e["id"] == i))
        event = next(e for e in events if e["id"] == selected)
        if section == "Events":
            st.dataframe([{"ID": e["id"], "Event": e["name"], "Date": e["eventDate"], "Status": e["status"], "Venue": e["venue"]} for e in events], hide_index=True)
        elif section == "Event Dashboard":
            values = client.get(f"events/{selected}/dashboard")
            columns = st.columns(3)
            for column, label, key in zip(columns, ["Registered attendees", "Accepted entries", "Remaining attendees"], ["totalAttendees", "checkedIn", "remaining"]):
                column.metric(label, values[key])
        elif section == "Scanner Staff & Access":
            access(client, event, events)
except APIError as exc:
    if exc.status == 401:
        st.session_state.clear()
        st.warning("Session expired. Sign in again.")
        if st.button("Return to sign in"):
            st.rerun()
    else:
        st.error(str(exc))
