"""Yerel rüzgâr tünelinin uçtan uca kabul kontrolleri.

Önce npm run dev başlatın; sonra uv run --with playwright python scripts/browser_smoke.py.
Kullanıcı tarayıcı profiline dokunmadan geçici, headless Chromium kullanır.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
import struct

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
FIXTURES = ARTIFACTS / "fixtures"
FIXTURES.mkdir(exist_ok=True)


def fixtures() -> dict[str, Path]:
    vertices = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
    faces = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)]
    data = b"".join(struct.pack("<3f", *vertices[i]) for face in faces for i in face)
    gltf = {
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "buffers": [{"byteLength": len(data)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(data), "target": 34962}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 12, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 1]}],
    }
    document = json.dumps(gltf).encode()
    document += b" " * ((-len(document)) % 4)
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(document) + 8 + len(data))
    glb += struct.pack("<II", len(document), 0x4E4F534A) + document
    glb += struct.pack("<II", len(data), 0x004E4942) + data
    (FIXTURES / "tetra.glb").write_bytes(glb)
    gltf["buffers"][0]["uri"] = "tetra.bin"
    (FIXTURES / "tetra.gltf").write_text(json.dumps(gltf))
    (FIXTURES / "tetra.bin").write_bytes(data)
    obj = "\n".join("v " + " ".join(map(str, v)) for v in vertices)
    obj += "\n" + "\n".join("f " + " ".join(str(i + 1) for i in face) for face in faces)
    (FIXTURES / "tetra.obj").write_text(obj)
    stl = "solid tetra\n"
    for face in faces:
        stl += "facet normal 0 0 0\nouter loop\n"
        stl += "\n".join("vertex " + " ".join(map(str, vertices[i])) for i in face)
        stl += "\nendloop\nendfacet\n"
    (FIXTURES / "tetra.stl").write_text(stl + "endsolid tetra\n")
    binary_stl = bytes(80) + struct.pack("<I", len(faces))
    for face in faces:
        binary_stl += struct.pack("<3f", 0, 0, 0)
        binary_stl += b"".join(struct.pack("<3f", *vertices[i]) for i in face) + struct.pack("<H", 0)
    (FIXTURES / "tetra-binary.stl").write_bytes(binary_stl)
    (FIXTURES / "broken.obj").write_text("This is not a model.")
    return {path.name: path for path in FIXTURES.iterdir()}


def value(page: Page, selector: str) -> float:
    return float(page.locator(selector).inner_text().split(" ")[0].replace(".", "").replace(",", "."))


def set_number(page: Page, key: str, number: float) -> None:
    page.locator(f"#{key}").fill(str(number))
    page.locator(f"#{key}").press("Tab")
    page.wait_for_timeout(100)


def main() -> None:
    files = fixtures()
    checks: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path="/home/muhammet/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
            args=["--enable-unsafe-swiftshader"],
        )
        page = browser.new_page(viewport={"width": 1500, "height": 1100}, device_scale_factor=1)
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5173/")
        page.wait_for_load_state("networkidle")
        expect(page.locator("#drag")).not_to_have_text("—")
        expect(page.locator(".model-thumb img")).to_have_count(6)
        page.screenshot(path=str(ARTIFACTS / "desktop-wing.png"), full_page=True)
        checks.append("WebGL scene and six model thumbnails")

        for model in ["cow", "spider", "sphere", "cube", "connect", "wing"]:
            page.locator(f'[data-model="{model}"]').click()
            expect(page.locator(f'[data-model="{model}"]')).to_have_attribute("aria-pressed", "true")
            assert math.isfinite(value(page, "#drag"))
            if model in ["cow", "spider", "connect"]:
                page.locator("#viewport").screenshot(path=str(ARTIFACTS / f"scene-{model}.png"))
        checks.append("All six built-in models render with finite force")

        page.locator('[data-model="sphere"]').click()
        baseline = value(page, "#drag")
        assert abs(baseline - 90.44) < 1
        set_number(page, "speed", 40)
        assert abs(value(page, "#drag") / baseline - 4) < 0.02
        set_number(page, "speed", 0)
        expect(page.locator("#drag")).to_have_text("0,0")
        expect(page.locator("#live-badge")).to_contain_text("Rüzgâr yok")
        set_number(page, "speed", 20)
        set_number(page, "scale", 2)
        assert abs(value(page, "#drag") / baseline - 4) < 0.02
        set_number(page, "scale", 1)
        set_number(page, "pressure", 50000)
        assert abs(value(page, "#drag") / baseline - 50000 / 101325) < 0.01
        page.locator("#reset").click()
        checks.append("Speed squared, scale squared, pressure and zero-wind behavior")

        page.locator("#play").click()
        expect(page.locator("#live-badge")).to_contain_text("Duraklatıldı")
        page.wait_for_timeout(300)
        paused = page.locator("#viewport canvas").evaluate("c => c.toDataURL()")
        page.wait_for_timeout(200)
        assert paused == page.locator("#viewport canvas").evaluate("c => c.toDataURL()")
        page.locator("#play").click()
        page.wait_for_timeout(200)
        assert paused != page.locator("#viewport canvas").evaluate("c => c.toDataURL()")
        for view in ["side", "top", "front", "perspective"]:
            page.locator(f'[data-view="{view}"]').click()
            expect(page.locator(f'[data-view="{view}"]')).to_have_class("view-button active")
        checks.append("Pause freezes canvas; restart animates; four camera views")

        page.locator('[data-model="wing"]').click()
        set_number(page, "pitch", 20)
        expect(page.locator("#drag")).to_have_text("—")
        expect(page.locator("#warnings")).to_contain_text("açı sınırı")
        set_number(page, "pitch", 6)
        assert value(page, "#lift") > 0
        set_number(page, "pitch", -6)
        assert value(page, "#lift") < 0
        page.locator('summary').filter(has_text="Geometri ve katsayılar").click()
        page.locator("#autoWing").uncheck()
        set_number(page, "cl", 0.5)
        set_number(page, "cd", 0.1)
        expect(page.locator("#result-cl")).to_have_text("0,500")
        page.locator("#manualArea").check()
        set_number(page, "area", 2)
        expect(page.locator("#reference-area")).to_have_text("2,000 m²")
        checks.append("Wing validity warning, lift direction, manual coefficients and reference area")

        page.locator("#record").click()
        set_number(page, "speed", 30)
        page.locator("#record").click()
        expect(page.locator("#runs-body tr")).to_have_count(2)
        with page.expect_download() as event:
            page.locator("#export").click()
        csv_path = ARTIFACTS / "verified-runs.csv"
        event.value.save_as(str(csv_path))
        with csv_path.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.DictReader(source, delimiter=";"))
        assert len(rows) == 2 and float(rows[1]["input_speed"]) == 30
        assert float(rows[0]["result_area"]) == 2
        with page.expect_download() as event:
            page.locator("#export-json").click()
        json_path = ARTIFACTS / "verified-runs.json"
        event.value.save_as(str(json_path))
        records = json.loads(json_path.read_text())["runs"]
        assert len(records) == 2 and records[1]["state"]["speed"] == 30
        assert records[0]["results"]["cd"] == 0.1
        page.locator('.delete-run[data-run="1"]').click()
        expect(page.locator("#runs-body tr")).to_have_count(1)
        checks.append("Run snapshots, actual CSV/JSON download contents, record removal")

        for filename in ["tetra.obj", "tetra.stl", "tetra-binary.stl", "tetra.glb"]:
            page.locator("#file-input").set_input_files(str(files[filename]))
            expect(page.locator("#scene-title")).to_contain_text(filename)
            expect(page.locator("#custom-model")).to_contain_text("4 üçgen")
            assert value(page, "#drag") > 0
        page.locator("#file-input").set_input_files([str(files["tetra.gltf"]), str(files["tetra.bin"])])
        expect(page.locator("#scene-title")).to_contain_text("tetra.gltf")
        page.locator('[data-model="sphere"]').click()
        page.locator('[data-model="custom"]').click()
        expect(page.locator("#scene-title")).to_contain_text("tetra.gltf")
        checks.append("OBJ, ASCII STL, binary STL, GLB, glTF+bin; custom model reselect")

        page.locator("#file-input").set_input_files(str(files["broken.obj"]))
        expect(page.locator("#toast")).to_contain_text("kullanılabilir bir üçgen yüzey")
        expect(page.locator("#scene-title")).to_contain_text("tetra.gltf")
        page.locator("#file-input").set_input_files(str(files["tetra.gltf"]))
        expect(page.locator("#toast")).to_contain_text("Eksik model dosyası")
        expect(page.locator("#upload")).to_be_enabled()
        expect(page.locator("#scene-title")).to_contain_text("tetra.gltf")
        checks.append("Invalid file and missing glTF dependency preserve current model")

        page.locator('[data-model="spider"]').click()
        page.locator("#reset").click()
        with page.expect_download() as event:
            page.locator("#screenshot").click()
        png_path = ARTIFACTS / "verified-scene.png"
        event.value.save_as(str(png_path))
        assert png_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        assert png_path.stat().st_size > 10000
        checks.append("PNG scene download")

        page.locator("#help").click()
        expect(page.locator("#help-dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator("#help-dialog")).not_to_be_visible()
        page.screenshot(path=str(ARTIFACTS / "desktop-final.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(200)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
        checks.append("Help dialog keyboard dismissal; 390 px mobile has no horizontal overflow")
        # Broken OBJ is a deliberately rejected fixture; no uncaught browser errors expected.
        assert not errors, errors
        (ARTIFACTS / "browser-results.json").write_text(json.dumps({"status": "passed", "checks": checks, "page_errors": errors}, ensure_ascii=False, indent=2))
        print(json.dumps({"status": "passed", "checks": len(checks), "page_errors": errors}, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    main()
