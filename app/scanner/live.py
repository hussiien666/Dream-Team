"""Local browser decoding: camera frames never leave the staff member's device."""
from pathlib import Path
import streamlit as st

FRONTEND = Path(__file__).with_name("frontend")


@st.cache_resource
def component():
    vendor = (FRONTEND / "jsQR.js").read_text(encoding="utf-8")
    # Load the unmodified UMD library in a private module scope.
    decoder = "const decodeQR = (() => { const module = {exports:{}}; const exports = module.exports;\n" + vendor + "\nreturn module.exports; })();\n"
    return st.components.v2.component("aast_live_qr_scanner",
        html='<section class="scanner" aria-label="Live QR scanner"></section>',
        css=(FRONTEND / "scanner.css").read_text(encoding="utf-8"),
        js=decoder + (FRONTEND / "scanner.js").read_text(encoding="utf-8"))


def live_scanner(event_id, entrance_id, feedback=None):
    result = component()(key=f"live_scan_{event_id}_{entrance_id}",
        data={"feedback": feedback}, on_scan_change=lambda: None)
    return result.scan
