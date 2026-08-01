import pytest
import numpy as np
from app.analyzer import BrightFeatureAnalyzer
from app.main import export_csv, ExportCSVRequest, ImageItemResult

def test_synthetic_image_fitting():
    true_cx = 250.0
    true_cy = 220.0
    true_r = 65.0
    
    img = BrightFeatureAnalyzer.generate_synthetic_image(
        width=500,
        height=500,
        cx=true_cx,
        cy=true_cy,
        radius=true_r,
        bg_level=15.0,
        peak_intensity=220.0,
        blur_sigma=3.0,
        noise_std=5.0
    )
    
    res = BrightFeatureAnalyzer.fit_auto(img)
    
    assert res["mode"] == "auto"
    assert abs(res["center_x"] - true_cx) <= 2.5
    assert abs(res["center_y"] - true_cy) <= 2.5
    assert abs(res["radius"] - true_r) <= 3.5
    assert res["fit_quality"] > 0.5

def test_fit_manual():
    img = np.ones((100, 100), dtype=np.uint8) * 10
    img[40:60, 40:60] = 200
    
    res = BrightFeatureAnalyzer.fit_manual(img, cx=50.0, cy=50.0, radius=12.0)
    
    assert res["mode"] == "manual"
    assert res["center_x"] == 50.0
    assert res["center_y"] == 50.0
    assert res["radius"] == 12.0
    assert res["mean_intensity_inside"] > 150

@pytest.mark.anyio
async def test_csv_export_endpoint():
    items = [
        ImageItemResult(
            filename="img1.png",
            source_path="/path/img1.png",
            center_x=280.5,
            center_y=290.2,
            radius=70.0,
            area_px=15393.8,
            mode="auto",
            fit_quality=1.0,
            mean_intensity_inside=210.0,
            snr=12.5
        ),
        ImageItemResult(
            filename="img2.png",
            source_path="/path/img2.png",
            center_x=310.0,
            center_y=250.0,
            radius=82.0,
            area_px=21124.1,
            mode="manual",
            fit_quality=1.0,
            mean_intensity_inside=205.0,
            snr=11.2
        )
    ]
    req = ExportCSVRequest(items=items)
    response = await export_csv(req)
    csv_text = response.body.decode("utf-8")
    
    assert "Filename,Source_Path,Center_X_px,Center_Y_px" in csv_text
    assert "img1.png,/path/img1.png,280.50,290.20,70.00,15393.8,auto" in csv_text
    assert "img2.png,/path/img2.png,310.00,250.00,82.00,21124.1,manual" in csv_text
