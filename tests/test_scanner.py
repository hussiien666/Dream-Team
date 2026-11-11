import base64
from io import BytesIO
from pathlib import Path
import json
import shutil
import subprocess
import pytest
from PIL import Image, ImageOps
from app.scanner.decoder import decode_qr
from app.ticket_engine.qr_generator import new_token, payload, qr_png


def test_photo_rotation_and_inverted_qr():
    raw, _ = new_token()
    original = Image.open(BytesIO(qr_png(raw))).convert("RGB")
    for image in (original.rotate(90, expand=True), ImageOps.invert(original)):
        file = BytesIO()
        image.save(file, format="JPEG", quality=80)
        assert decode_qr(file.getvalue()) == payload(raw)


@pytest.mark.skipif(not shutil.which("node"), reason="Node is optional; needed only to verify the bundled browser decoder")
def test_actual_browser_decoder_reads_generated_ticket(tmp_path):
    raw, _ = new_token()
    qr = Image.open(BytesIO(qr_png(raw))).convert("RGBA")
    fixture = tmp_path / "qr.json"
    fixture.write_text(json.dumps({"width": qr.width, "height": qr.height, "pixels": base64.b64encode(qr.tobytes()).decode()}))
    library = Path(__file__).resolve().parents[1] / "app/scanner/frontend/jsQR.js"
    script = "const fs=require('fs');const decode=require(process.argv[1]);const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const value=decode(new Uint8ClampedArray(Buffer.from(f.pixels,'base64')),f.width,f.height);if(!value)process.exit(2);process.stdout.write(value.data);"
    result = subprocess.run(["node", "-e", script, str(library), str(fixture)], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    assert result.stdout == payload(raw)
