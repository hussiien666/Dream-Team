import streamlit as st
from sqlalchemy import func, select
from app.backend.database import SessionLocal
from app.backend.models import Category, Entrance, EntrancePermission, Ticket
from app.backend.services.access import delete_access, save_category, save_entrance
from app.dashboard.common import perform, table, token


def render(event_id):
    st.header("Entrances & Categories")
    st.caption("Step 2 · Add categories, then choose which ones each entrance accepts.")
    with SessionLocal() as s:
        categories = s.scalars(select(Category).where(Category.event_id == event_id).order_by(Category.name)).all()
        entrances = s.scalars(select(Entrance).where(Entrance.event_id == event_id).order_by(Entrance.name)).all()
        permissions = s.scalars(select(EntrancePermission).where(EntrancePermission.event_id == event_id)).all()
        issued = dict(s.execute(select(Ticket.category_id, func.count()).where(Ticket.event_id == event_id).group_by(Ticket.category_id)).all())
    st.subheader("Ticket categories")
    table([{"Category": c.name, "Code": c.code, "Allocation": c.allocation, "Issued": issued.get(c.id, 0),
            "Tickets per attendee": c.max_per_attendee, "Status": "Active" if c.active else "Inactive"} for c in categories])
    if st.button("Add category", type="primary"):
        st.session_state.access_editor = (event_id, "category", "new")
    cat_id = st.selectbox("Select category", [c.id for c in categories], format_func=lambda i: next(c.name for c in categories if c.id == i)) if categories else None
    if cat_id and st.button("Edit category"):
        st.session_state.access_editor = (event_id, "category", cat_id)
    st.subheader("Entrances")
    table([{"Entrance": e.name, "Code": e.code, "Location": e.location,
            "Allowed categories": ", ".join(c.name for c in categories if any(p.entrance_id == e.id and p.category_id == c.id for p in permissions)) or "None — entry blocked",
            "Status": "Active" if e.active else "Inactive"} for e in entrances])
    if st.button("Add entrance", type="primary"):
        st.session_state.access_editor = (event_id, "entrance", "new")
    gate_id = st.selectbox("Select entrance", [e.id for e in entrances], format_func=lambda i: next(e.name for e in entrances if e.id == i)) if entrances else None
    if gate_id and st.button("Edit entrance"):
        st.session_state.access_editor = (event_id, "entrance", gate_id)
    state = st.session_state.get("access_editor")
    if state and state[0] == event_id:
        _, kind, object_id = state
        objects = categories if kind == "category" else entrances
        obj = next((c for c in objects if c.id == object_id), None)
        st.subheader(("Add " if obj is None else "Edit ") + kind)
        get = lambda field, default="": getattr(obj, field) if obj else default
        with st.form(f"access_{event_id}_{kind}_{object_id}"):
            data = {"name": st.text_input("Name *", value=get("name"), max_chars=120),
                    "code": st.text_input("Code *", value=get("code"), max_chars=40),
                    "description": st.text_area("Description", value=get("description"), max_chars=3000),
                    "active": st.checkbox("Active", value=get("active", True))}
            allowed = []
            if kind == "category":
                data["allocation"] = st.number_input("Maximum allocation", min_value=1, value=get("allocation", 100), step=1)
                data["max_per_attendee"] = st.number_input("Maximum tickets per attendee", min_value=1, value=get("max_per_attendee", 1), step=1)
                data["color"] = st.color_picker("Category color", value=get("color", "#142D4E"))
                data["price"] = st.number_input("Price (record only; no payments)", min_value=0.0, value=float(get("price", 0)), step=1.0)
            else:
                data["location"] = st.text_input("Building or location", value=get("location"), max_chars=200)
                data["instructions"] = st.text_area("Access instructions", value=get("instructions"), max_chars=3000)
                allowed = st.multiselect("Allowed ticket categories", [c.id for c in categories],
                    default=[p.category_id for p in permissions if obj and p.entrance_id == obj.id],
                    format_func=lambda i: next(c.name for c in categories if c.id == i))
                st.caption("An entrance with no allowed categories rejects every ticket.")
            c1, c2 = st.columns([1, 5])
            save = c1.form_submit_button("Save", type="primary")
            cancel = c2.form_submit_button("Cancel")
        if cancel:
            st.session_state.pop("access_editor", None)
            st.rerun()
        if save:
            fn = (lambda s: save_category(s, token(), event_id, data, obj.id if obj else None)) if kind == "category" else (lambda s: save_entrance(s, token(), event_id, data, allowed, obj.id if obj else None))
            ok, _ = perform(fn, rerun=False)
            if ok:
                st.session_state.pop("access_editor", None)
                st.session_state.flash = kind.title() + " saved."
                st.rerun()
    with st.expander("Delete a category or entrance"):
        kind = st.selectbox("Record type", ["category", "entrance"])
        selected = cat_id if kind == "category" else gate_id
        st.caption("Select the record in its table section above. Records with attendees or check-in history must be made inactive instead.")
        confirmed = st.checkbox("I confirm deletion of the selected record", key=f"delete_access_{event_id}_{kind}_{selected}")
        if st.button("Delete", disabled=not confirmed or not selected):
            perform(lambda s: delete_access(s, token(), event_id, selected, kind), "Record deleted.")
