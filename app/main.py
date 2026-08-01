import os
import io
import sys
import argparse
import base64
import csv
from pathlib import Path
from typing import Optional, List

# Ensure parent directory is in python path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

from app.analyzer import BrightFeatureAnalyzer

app = FastAPI(title="Bright Feature Circle Fitter API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

startup_config: dict = {
    "default_folder": os.environ.get("SPOTFIT_DIR", None)
}

active_image_cache: dict = {
    "image_np": None,
    "source_name": None,
    "base64_data": None
}

class PathLoadRequest(BaseModel):
    path: str
    mode: str = "auto"
    manual_cx: Optional[float] = None
    manual_cy: Optional[float] = None
    manual_radius: Optional[float] = None

class DirListRequest(BaseModel):
    dir_path: str

class ManualFitRequest(BaseModel):
    cx: float
    cy: float
    radius: float

class SampleGenRequest(BaseModel):
    cx: float = 300.0
    cy: float = 300.0
    radius: float = 80.0
    noise_std: float = 8.0
    bg_level: float = 25.0
    peak_intensity: float = 230.0

class ImageItemResult(BaseModel):
    filename: str
    source_path: str
    center_x: float
    center_y: float
    radius: float
    area_px: float
    mode: str
    fit_quality: float
    mean_intensity_inside: float
    snr: float

class ExportCSVRequest(BaseModel):
    items: List[ImageItemResult]

def numpy_to_base64_png(gray_img) -> str:
    pil_img = Image.fromarray(gray_img)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    b64_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{b64_str}"

@app.get("/api/initial-config")
async def get_initial_config():
    """Returns startup configuration, including default folder path if specified at launch."""
    folder = startup_config.get("default_folder")
    if folder:
        folder = os.path.abspath(folder.strip('"').strip("'"))
    return {
        "status": "success",
        "default_folder": folder
    }

@app.post("/api/upload")
async def upload_image(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    manual_cx: Optional[float] = Form(None),
    manual_cy: Optional[float] = Form(None),
    manual_radius: Optional[float] = Form(None)
):
    try:
        contents = await file.read()
        img_np = BrightFeatureAnalyzer.load_image_from_bytes(contents)
        b64_img = numpy_to_base64_png(img_np)
        
        active_image_cache["image_np"] = img_np
        active_image_cache["source_name"] = file.filename
        active_image_cache["base64_data"] = b64_img

        if mode == "manual" and manual_cx is not None and manual_cy is not None and manual_radius is not None:
            metrics = BrightFeatureAnalyzer.fit_manual(img_np, manual_cx, manual_cy, manual_radius)
        else:
            metrics = BrightFeatureAnalyzer.fit_auto(img_np)

        return {
            "status": "success",
            "source_path": f"[Uploaded File] {file.filename}",
            "filename": file.filename,
            "image_data": b64_img,
            "metrics": metrics
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process uploaded image: {str(e)}")

@app.post("/api/load-path")
async def load_image_path(req: PathLoadRequest):
    file_path = req.path.strip('"').strip("'")
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"File not found at path: {file_path}")

    try:
        img_np = BrightFeatureAnalyzer.load_image_from_path(file_path)
        b64_img = numpy_to_base64_png(img_np)
        
        active_image_cache["image_np"] = img_np
        active_image_cache["source_name"] = os.path.basename(file_path)
        active_image_cache["base64_data"] = b64_img

        if req.mode == "manual" and req.manual_cx is not None and req.manual_cy is not None and req.manual_radius is not None:
            metrics = BrightFeatureAnalyzer.fit_manual(img_np, req.manual_cx, req.manual_cy, req.manual_radius)
        else:
            metrics = BrightFeatureAnalyzer.fit_auto(img_np)

        return {
            "status": "success",
            "source_path": os.path.abspath(file_path),
            "filename": os.path.basename(file_path),
            "image_data": b64_img,
            "metrics": metrics
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load image from path: {str(e)}")

@app.post("/api/list-dir")
async def list_directory_images(req: DirListRequest):
    dir_path = req.dir_path.strip('"').strip("'")
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail=f"Directory not found: {dir_path}")

    valid_extensions = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    images = []
    try:
        for entry in os.scandir(dir_path):
            if entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in valid_extensions:
                    images.append({
                        "filename": entry.name,
                        "full_path": os.path.abspath(entry.path)
                    })
        images.sort(key=lambda x: x["filename"].lower())
        return {
            "status": "success",
            "dir_path": os.path.abspath(dir_path),
            "count": len(images),
            "files": images
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing directory: {str(e)}")

@app.post("/api/folder/analyze-all")
async def analyze_folder_all(req: DirListRequest):
    dir_path = req.dir_path.strip('"').strip("'")
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail=f"Directory not found: {dir_path}")

    valid_extensions = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    results = []
    
    try:
        entries = [e for e in os.scandir(dir_path) if e.is_file() and os.path.splitext(e.name)[1].lower() in valid_extensions]
        entries.sort(key=lambda x: x.name.lower())

        for entry in entries:
            full_path = os.path.abspath(entry.path)
            img_np = BrightFeatureAnalyzer.load_image_from_path(full_path)
            b64_img = numpy_to_base64_png(img_np)
            metrics = BrightFeatureAnalyzer.fit_auto(img_np)
            
            results.append({
                "filename": entry.name,
                "source_path": full_path,
                "image_data": b64_img,
                "metrics": metrics
            })

        return {
            "status": "success",
            "dir_path": os.path.abspath(dir_path),
            "count": len(results),
            "items": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing folder images: {str(e)}")

@app.post("/api/sample")
async def generate_sample(req: SampleGenRequest):
    try:
        img_np = BrightFeatureAnalyzer.generate_synthetic_image(
            width=600,
            height=600,
            cx=req.cx,
            cy=req.cy,
            radius=req.radius,
            bg_level=req.bg_level,
            peak_intensity=req.peak_intensity,
            blur_sigma=4.0,
            noise_std=req.noise_std
        )
        b64_img = numpy_to_base64_png(img_np)
        
        active_image_cache["image_np"] = img_np
        active_image_cache["source_name"] = "synthetic_sample.png"
        active_image_cache["base64_data"] = b64_img

        metrics = BrightFeatureAnalyzer.fit_auto(img_np)
        return {
            "status": "success",
            "source_path": "Synthetic Demo Image (600x600)",
            "filename": "synthetic_sample.png",
            "image_data": b64_img,
            "metrics": metrics
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating sample: {str(e)}")

@app.post("/api/sample-batch")
async def generate_sample_batch():
    specs = [
        {"filename": "spot_sample_01.png", "cx": 280.0, "cy": 290.0, "radius": 70.0},
        {"filename": "spot_sample_02.png", "cx": 350.0, "cy": 220.0, "radius": 85.0},
        {"filename": "spot_sample_03.png", "cx": 210.0, "cy": 380.0, "radius": 60.0},
    ]
    items = []
    for spec in specs:
        img_np = BrightFeatureAnalyzer.generate_synthetic_image(
            width=600,
            height=600,
            cx=spec["cx"],
            cy=spec["cy"],
            radius=spec["radius"],
            bg_level=20.0,
            peak_intensity=225.0,
            blur_sigma=4.0,
            noise_std=8.0
        )
        b64_img = numpy_to_base64_png(img_np)
        metrics = BrightFeatureAnalyzer.fit_auto(img_np)
        items.append({
            "filename": spec["filename"],
            "source_path": f"[Demo Folder] {spec['filename']}",
            "image_data": b64_img,
            "metrics": metrics
        })

    return {
        "status": "success",
        "dir_path": "[Demo 3-Image Folder]",
        "count": len(items),
        "items": items
    }

@app.post("/api/reanalyze")
async def reanalyze_active_image(req: PathLoadRequest):
    img_np = active_image_cache.get("image_np")
    
    if img_np is None and req.path and os.path.isfile(req.path):
        img_np = BrightFeatureAnalyzer.load_image_from_path(req.path)
        active_image_cache["image_np"] = img_np
        active_image_cache["source_name"] = os.path.basename(req.path)
        active_image_cache["base64_data"] = numpy_to_base64_png(img_np)

    if img_np is None:
        raise HTTPException(status_code=400, detail="No active image found. Please load or upload an image first.")

    if req.mode == "manual" and req.manual_cx is not None and req.manual_cy is not None and req.manual_radius is not None:
        metrics = BrightFeatureAnalyzer.fit_manual(img_np, req.manual_cx, req.manual_cy, req.manual_radius)
    else:
        metrics = BrightFeatureAnalyzer.fit_auto(img_np)

    return {
        "status": "success",
        "source_path": active_image_cache.get("source_name", "Active Image"),
        "filename": active_image_cache.get("source_name", "Active Image"),
        "image_data": active_image_cache.get("base64_data"),
        "metrics": metrics
    }

@app.post("/api/export-csv")
async def export_csv(req: ExportCSVRequest):
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow([
        "Filename",
        "Source_Path",
        "Center_X_px",
        "Center_Y_px",
        "Radius_px",
        "Area_px2",
        "Fit_Mode",
        "Fit_Quality",
        "Mean_Intensity_Inside",
        "SNR"
    ])
    
    for item in req.items:
        writer.writerow([
            item.filename,
            item.source_path,
            f"{item.center_x:.2f}",
            f"{item.center_y:.2f}",
            f"{item.radius:.2f}",
            f"{item.area_px:.1f}",
            item.mode,
            f"{item.fit_quality:.2f}",
            f"{item.mean_intensity_inside:.2f}",
            f"{item.snr:.2f}"
        ])
        
    csv_bytes = output.getvalue().encode('utf-8')
    headers = {
        'Content-Disposition': 'attachment; filename="fitted_circle_centers.csv"'
    }
    return Response(content=csv_bytes, media_type="text/csv", headers=headers)

# Mount static files directory for frontend
static_dir = Path(__file__).parent.parent / "static"
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

def main():
    parser = argparse.ArgumentParser(description="SpotFit Bright Feature Circle Fitter Server")
    parser.add_argument("--dir", "-d", help="Path to initial image folder to load on startup", default=None)
    parser.add_argument("--port", "-p", type=int, help="Port to run server on", default=8000)
    parser.add_argument("--host", help="Host address to run server on", default="127.0.0.1")
    args, unknown = parser.parse_known_args()

    if args.dir:
        startup_config["default_folder"] = args.dir

    import uvicorn
    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=False)

if __name__ == "__main__":
    main()
