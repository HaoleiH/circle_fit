Build a web application named "SpotFit" with a Python backend and an interactive HTML5/JS frontend for sub-pixel bright feature center detection and circle fitting on grayscale images with dark backgrounds.

### Tech Stack
- **Backend**: Python 3.12+ (FastAPI, Uvicorn, OpenCV `opencv-python-headless`, NumPy, SciPy, Pillow, `python-multipart`). Use `uv` for package management.
- **Frontend**: Single-Page Web App using standard HTML5, modern CSS3 (Glassmorphism dark theme with glowing cyan and purple accents), and vanilla JavaScript (HTML5 Canvas).

---

### Core Architecture & Key Requirements

1. **Robust Circle Fitting Algorithm (`app/analyzer.py`)**:
   - **Preprocessing**: Convert to grayscale, apply Gaussian blur (kernel size 9x9, sigma 2.0), check image contrast.
   - **Coarse Localization**: Combine Otsu's thresholding with adaptive top-percentile intensity cutoffs. Find contours of bright blobs and compute initial minimum enclosing circles.
   - **Sub-Pixel Centroid Refinement**: Calculate intensity-weighted center of mass around initial guess:
     $$\bar{x} = \frac{\sum x \cdot I(x,y)^{1.5}}{\sum I(x,y)^{1.5}}, \quad \bar{y} = \frac{\sum y \cdot I(x,y)^{1.5}}{\sum I(x,y)^{1.5}}$$
   - **Radial Ray Edge Detection & Circle Fit**: Sample 64 radial rays emanating from sub-pixel center, compute bilinear intensity gradients along each ray to locate maximum negative intensity drops, and run RANSAC least-squares circle fitting on edge points.
   - **Metrics Calculation**: Compute Center $(X, Y)$, Radius $R$, Area ($\pi R^2$), Mean Intensity inside circle, Background Mean, Contrast Ratio, Signal-to-Noise Ratio (SNR), Fit Quality Score, and 50-bin Radial Intensity Profile.
   - **Synthetic Image Generator**: Provide `generate_synthetic_image(...)` function to create synthetic test spots with configurable center, radius, blur, background level, and noise.

2. **Backend API Endpoints (`app/main.py`)**:
   - `POST /api/upload`: Process direct file upload (single or multiple).
   - `POST /api/load-path`: Process local file path string.
   - `POST /api/list-dir`: List image files (`.png`, `.jpg`, `.bmp`, `.tiff`) in a directory.
   - `POST /api/folder/analyze-all`: Batch scan and fit all images in a folder path.
   - `POST /api/sample`: Generate a single synthetic demo image.
   - `POST /api/sample-batch`: Generate a 3-image synthetic folder dataset (`spot_sample_01.png`, `spot_sample_02.png`, `spot_sample_03.png`).
   - `POST /api/reanalyze`: Re-evaluate metrics for an active image given updated mode or manual $(X, Y, R)$.
   - `POST /api/export-csv`: Generate downloadable `fitted_circle_centers.csv` containing columns:
     `Filename`, `Source_Path`, `Center_X_px`, `Center_Y_px`, `Radius_px`, `Area_px2`, `Fit_Mode`, `Fit_Quality`, `Mean_Intensity_Inside`, `SNR`.
   - `GET /api/initial-config`: Return startup folder config set via CLI argument (`--dir` / `-d`) or environment variable (`SPOTFIT_DIR`).

3. **Interactive Frontend (`static/index.html`, `static/style.css`, `static/app.js`)**:
   - **Modern Dark UI Design**: Dark background (`#0b0f19`), glassmorphism cards, glowing cyan accents (`#00f2fe`) for Auto mode and purple accents (`#a855f7`) for Manual mode.
   - **Multi-Image Batch Bar**: Thumbnail/card list for all images in the loaded folder. Clicking an item switches active viewport canvas.
   - **Per-Image Auto/Manual Mode Switch**: Default mode is **Auto**. Toggling switch to **Manual** allows:
     - Dragging the center dot $(X, Y)$ on canvas to move circle.
     - Dragging the radius ring control handle to resize circle $R$.
     - Numerical number input fields for precise typing.
   - **Interactive Main Viewport Canvas**: Smooth Zoom (mouse wheel) and Pan (click-drag canvas), crosshair target, grid overlay toggle, coordinate tag labels.
   - **Batch Summary Table**: Real-time summary table listing filename, Center X, Center Y, Radius R, and mode for all images.
   - **Batch Analysis Report Section**: Dedicated grid section at the bottom displaying report cards for all images. Each report card contains a live rendered thumbnail preview canvas with fitted circle overlay and metrics. Updates in **real-time** whenever any image parameter is modified.
   - **CSV Export Buttons**: Prominent "Export CSV" buttons in sidebar, summary card, and report section header.
   - **Startup Folder Support**:
     1. Automatically loads folder from browser URL parameter `?folder=C:/path/to/folder` on webpage open.
     2. Automatically loads folder passed via CLI launch argument `--dir "C:/path/to/folder"`.
     3. Fallback to 1-click 3-image demo batch if no startup folder specified.

4. **Directory Structure**:
   ```text
   project_root/
   ├── app/
   │   ├── __init__.py
   │   ├── analyzer.py
   │   └── main.py
   ├── static/
   │   ├── index.html
   │   ├── style.css
   │   └── app.js
   ├── tests/
   │   └── test_analyzer.py
   └── pyproject.toml



Run server with `uv run python app/main.py --port 8000`
