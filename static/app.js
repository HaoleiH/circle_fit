// SpotFit - Multi-Image Folder Fitting & CSV Export Engine with Dynamic Report & Startup Folder Support

document.addEventListener('DOMContentLoaded', async () => {
    // State management
    const state = {
        // Multi-image batch state
        batch: [], // Array of { filename, sourcePath, imageData, mode, cx, cy, radius, metrics, imgElement }
        activeBatchIndex: -1,
        sourceFolder: '',

        // Canvas View Transforms (Zoom & Pan)
        scale: 1.0,
        panX: 0,
        panY: 0,
        isPanning: false,
        startPanX: 0,
        startPanY: 0,
        showGrid: true,

        // Manual Interaction Dragging
        isDraggingCenter: false,
        isDraggingRadius: false,
        dragOffsetX: 0,
        dragOffsetY: 0
    };

    // DOM Element Handles
    const elements = {
        toggleMode: document.getElementById('toggle-fitting-mode'),
        labelAuto: document.getElementById('label-auto'),
        labelManual: document.getElementById('label-manual'),
        autoModeInfo: document.getElementById('auto-mode-info'),
        manualControlsPanel: document.getElementById('manual-controls-panel'),
        
        numCx: document.getElementById('num-cx'),
        numCy: document.getElementById('num-cy'),
        numRadius: document.getElementById('num-radius'),
        btnRefitAuto: document.getElementById('btn-refit-auto'),

        sourcePathDisplay: document.getElementById('source-path-display'),
        batchCountText: document.getElementById('batch-count-text'),
        batchItemList: document.getElementById('batch-item-list'),
        summaryTableBody: document.getElementById('summary-table-body'),
        btnExportCsv: document.getElementById('btn-export-csv'),
        btnExportCsvReport: document.getElementById('btn-export-csv-report'),
        reportGrid: document.getElementById('report-grid'),

        activeImageTitle: document.getElementById('active-image-title'),
        activeModeBadge: document.getElementById('active-mode-badge'),
        imageDimBadge: document.getElementById('image-dim-badge'),
        mouseCoords: document.getElementById('mouse-coords'),

        dropZone: document.getElementById('drop-zone'),
        fileInput: document.getElementById('file-input'),
        inputFilePath: document.getElementById('input-file-path'),
        btnLoadPath: document.getElementById('btn-load-path'),
        inputDirPath: document.getElementById('input-dir-path'),
        btnAnalyzeFolder: document.getElementById('btn-analyze-folder'),
        dirFileList: document.getElementById('dir-file-list'),
        
        btnDemo: document.getElementById('btn-demo'),
        btnDemoBatch: document.getElementById('btn-demo-batch'),

        btnZoomIn: document.getElementById('btn-zoom-in'),
        btnZoomOut: document.getElementById('btn-zoom-out'),
        btnZoomReset: document.getElementById('btn-zoom-reset'),
        btnToggleGrid: document.getElementById('btn-toggle-grid'),

        mainCanvas: document.getElementById('main-canvas'),
        canvasWrapper: document.getElementById('canvas-wrapper'),
        emptyState: document.getElementById('empty-state'),
        profileCanvas: document.getElementById('canvas-profile'),
        toastContainer: document.getElementById('toast-container')
    };

    const ctx = elements.mainCanvas.getContext('2d');
    const profileCtx = elements.profileCanvas.getContext('2d');

    // -------------------------------------------------------------
    // Event Listeners & Mode Toggle (Per Active Image)
    // -------------------------------------------------------------
    elements.toggleMode.addEventListener('change', (e) => {
        const item = getActiveItem();
        if (!item) return;

        const newMode = e.target.checked ? 'manual' : 'auto';
        item.mode = newMode;
        updateModeUI(newMode);

        if (newMode === 'auto') {
            reanalyzeActiveItemAuto();
        } else {
            triggerReanalyzeItem(item);
        }
    });

    function updateModeUI(mode) {
        if (mode === 'auto') {
            elements.labelAuto.classList.add('active');
            elements.labelManual.classList.remove('active');
            elements.autoModeInfo.classList.remove('hidden');
            elements.manualControlsPanel.classList.add('hidden');
            elements.activeModeBadge.textContent = 'AUTO MODE';
            elements.activeModeBadge.className = 'badge badge-cyan';
        } else {
            elements.labelAuto.classList.remove('active');
            elements.labelManual.classList.add('active');
            elements.autoModeInfo.classList.add('hidden');
            elements.manualControlsPanel.classList.remove('hidden');
            elements.activeModeBadge.textContent = 'MANUAL MODE';
            elements.activeModeBadge.className = 'badge badge-purple';
        }
    }

    elements.btnRefitAuto.addEventListener('click', () => {
        const item = getActiveItem();
        if (!item) return;

        item.mode = 'auto';
        elements.toggleMode.checked = false;
        updateModeUI('auto');
        reanalyzeActiveItemAuto();
    });

    // Manual input numerical changes
    [elements.numCx, elements.numCy, elements.numRadius].forEach(input => {
        input.addEventListener('change', () => {
            const item = getActiveItem();
            if (item && item.mode === 'manual') {
                item.cx = parseFloat(elements.numCx.value) || 0;
                item.cy = parseFloat(elements.numCy.value) || 0;
                item.radius = Math.max(1, parseFloat(elements.numRadius.value) || 10);
                triggerReanalyzeItem(item);
            }
        });
    });

    // Tab buttons navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // File Drag & Drop Upload
    elements.dropZone.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFilesBatch(Array.from(e.target.files));
        }
    });

    elements.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropZone.classList.add('drag-over');
    });

    elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('drag-over'));

    elements.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            uploadFilesBatch(Array.from(e.dataTransfer.files));
        }
    });

    // Folder Batch Fitting
    elements.btnAnalyzeFolder.addEventListener('click', () => {
        const dirVal = elements.inputDirPath.value.trim();
        if (!dirVal) {
            showToast('Please enter a folder path.', 'error');
            return;
        }
        analyzeFolderBatch(dirVal);
    });

    // Single Path Load
    elements.btnLoadPath.addEventListener('click', () => {
        const pathVal = elements.inputFilePath.value.trim();
        if (!pathVal) {
            showToast('Please enter a file path.', 'error');
            return;
        }
        loadImagePathSingle(pathVal);
    });

    // Demo Buttons
    elements.btnDemoBatch.addEventListener('click', () => loadDemoBatch3Images());
    elements.btnDemo.addEventListener('click', () => loadSingleDemoImage());

    // Export CSV Triggers
    elements.btnExportCsv.addEventListener('click', () => exportCSV());
    elements.btnExportCsvReport.addEventListener('click', () => exportCSV());

    // Viewport Controls
    elements.btnZoomIn.addEventListener('click', () => adjustZoom(1.2));
    elements.btnZoomOut.addEventListener('click', () => adjustZoom(0.8));
    elements.btnZoomReset.addEventListener('click', () => resetView());
    elements.btnToggleGrid.addEventListener('click', () => {
        state.showGrid = !state.showGrid;
        elements.btnToggleGrid.classList.toggle('active', state.showGrid);
        render();
    });

    // -------------------------------------------------------------
    // Helper & API Functions
    // -------------------------------------------------------------
    function getActiveItem() {
        if (state.activeBatchIndex >= 0 && state.activeBatchIndex < state.batch.length) {
            return state.batch[state.activeBatchIndex];
        }
        return null;
    }

    async function loadDemoBatch3Images() {
        try {
            showToast('Generating 3-Image Demo Batch...');
            const response = await fetch('/api/sample-batch', { method: 'POST' });
            const data = await response.json();
            if (response.ok) {
                populateBatch(data.items, data.dir_path);
                showToast(`Loaded ${data.count} demo images!`);
            }
        } catch (err) {
            showToast('Failed to load demo batch.', 'error');
        }
    }

    async function loadSingleDemoImage() {
        try {
            showToast('Loading single demo spot...');
            const response = await fetch('/api/sample', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cx: 300, cy: 300, radius: 75 })
            });
            const data = await response.json();
            if (response.ok) {
                populateBatch([{
                    filename: data.filename,
                    source_path: data.source_path,
                    image_data: data.image_data,
                    metrics: data.metrics
                }], data.source_path);
                showToast('Loaded demo spot image');
            }
        } catch (err) {
            showToast('Demo generation failed.', 'error');
        }
    }

    async function analyzeFolderBatch(dirPath) {
        try {
            elements.inputDirPath.value = dirPath;
            showToast(`Scanning and fitting folder: ${dirPath}...`);
            const response = await fetch('/api/folder/analyze-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dir_path: dirPath })
            });
            const data = await response.json();
            if (response.ok) {
                if (data.count === 0) {
                    showToast('No valid images found in directory.', 'error');
                    return;
                }
                populateBatch(data.items, data.dir_path);
                showToast(`Successfully fitted ${data.count} images in folder.`);
            } else {
                showToast(data.detail || 'Folder analysis failed.', 'error');
            }
        } catch (err) {
            showToast('Error connecting to backend.', 'error');
        }
    }

    async function uploadFilesBatch(files) {
        showToast(`Uploading ${files.length} image(s)...`);
        const newItems = [];
        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('mode', 'auto');
            try {
                const response = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await response.json();
                if (response.ok) {
                    newItems.push({
                        filename: data.filename,
                        source_path: data.source_path,
                        image_data: data.image_data,
                        metrics: data.metrics
                    });
                }
            } catch (e) {
                console.error(e);
            }
        }
        if (newItems.length > 0) {
            populateBatch(newItems, '[Uploaded Batch]');
            showToast(`Loaded ${newItems.length} uploaded images.`);
        }
    }

    async function loadImagePathSingle(filePath) {
        try {
            const response = await fetch('/api/load-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, mode: 'auto' })
            });
            const data = await response.json();
            if (response.ok) {
                populateBatch([{
                    filename: data.filename,
                    source_path: data.source_path,
                    image_data: data.image_data,
                    metrics: data.metrics
                }], data.source_path);
                showToast('Image loaded successfully');
            } else {
                showToast(data.detail || 'Path load failed', 'error');
            }
        } catch (err) {
            showToast('Error connecting to backend.', 'error');
        }
    }

    // Populate state.batch with list of backend items
    function populateBatch(rawItems, folderPath) {
        state.sourceFolder = folderPath;
        elements.sourcePathDisplay.textContent = folderPath;
        elements.emptyState.classList.add('hidden');

        state.batch = rawItems.map((raw, idx) => {
            const imgObj = new Image();
            imgObj.src = raw.image_data;
            return {
                id: idx,
                filename: raw.filename,
                sourcePath: raw.source_path,
                imageData: raw.image_data,
                mode: raw.metrics.mode || 'auto',
                cx: raw.metrics.center_x,
                cy: raw.metrics.center_y,
                radius: raw.metrics.radius,
                metrics: raw.metrics,
                imgElement: imgObj
            };
        });

        elements.batchCountText.textContent = state.batch.length;
        renderBatchItemList();
        renderSummaryTable();
        renderReportSection();
        setActiveBatchItem(0);
    }

    function setActiveBatchItem(index) {
        if (index < 0 || index >= state.batch.length) return;
        state.activeBatchIndex = index;
        const item = state.batch[index];

        elements.activeImageTitle.textContent = `${item.filename}`;
        elements.toggleMode.checked = (item.mode === 'manual');
        updateModeUI(item.mode);
        updateNumericInputs(item);

        renderBatchItemList();
        renderSummaryTable();
        renderReportSection();

        if (item.imgElement.complete) {
            elements.imageDimBadge.textContent = `${item.imgElement.width} x ${item.imgElement.height}`;
            resetView();
            renderProfilePlot(item.metrics.radial_profile);
            render();
        } else {
            item.imgElement.onload = () => {
                elements.imageDimBadge.textContent = `${item.imgElement.width} x ${item.imgElement.height}`;
                resetView();
                renderProfilePlot(item.metrics.radial_profile);
                render();
            };
        }
    }

    function updateNumericInputs(item) {
        elements.numCx.value = item.cx;
        elements.numCy.value = item.cy;
        elements.numRadius.value = item.radius;
    }

    async function triggerReanalyzeItem(item) {
        try {
            const response = await fetch('/api/reanalyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: item.sourcePath,
                    mode: item.mode,
                    manual_cx: item.cx,
                    manual_cy: item.cy,
                    manual_radius: item.radius
                })
            });
            const data = await response.json();
            if (response.ok) {
                item.metrics = data.metrics;
                item.cx = data.metrics.center_x;
                item.cy = data.metrics.center_y;
                item.radius = data.metrics.radius;
                renderSummaryTable();
                renderReportSection();
                renderProfilePlot(item.metrics.radial_profile);
                render();
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function reanalyzeActiveItemAuto() {
        const item = getActiveItem();
        if (!item) return;
        item.mode = 'auto';
        try {
            const response = await fetch('/api/reanalyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: item.sourcePath,
                    mode: 'auto'
                })
            });
            const data = await response.json();
            if (response.ok) {
                item.metrics = data.metrics;
                item.cx = data.metrics.center_x;
                item.cy = data.metrics.center_y;
                item.radius = data.metrics.radius;
                updateNumericInputs(item);
                renderSummaryTable();
                renderReportSection();
                renderProfilePlot(item.metrics.radial_profile);
                render();
            }
        } catch (err) {
            console.error(err);
        }
    }

    // -------------------------------------------------------------
    // Batch UI Rendering & Dynamic Report Section
    // -------------------------------------------------------------
    function renderBatchItemList() {
        elements.batchItemList.innerHTML = '';
        if (state.batch.length === 0) {
            elements.batchItemList.innerHTML = '<div class="empty-batch-text">No images loaded yet.</div>';
            return;
        }

        state.batch.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = `batch-item ${idx === state.activeBatchIndex ? 'active' : ''}`;
            
            const badgeClass = item.mode === 'manual' ? 'badge-purple' : 'badge-cyan';
            div.innerHTML = `
                <div class="batch-item-left">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="9"></circle>
                    </svg>
                    <span class="file-name" title="${item.filename}">${item.filename}</span>
                </div>
                <div class="batch-item-right">
                    <span class="batch-coords">(${item.cx}, ${item.cy})</span>
                    <span class="badge ${badgeClass}">${item.mode.toUpperCase()}</span>
                </div>
            `;
            div.addEventListener('click', () => setActiveBatchItem(idx));
            elements.batchItemList.appendChild(div);
        });
    }

    function renderSummaryTable() {
        elements.summaryTableBody.innerHTML = '';
        if (state.batch.length === 0) {
            elements.summaryTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No images analyzed yet</td></tr>';
            return;
        }

        state.batch.forEach((item, idx) => {
            const tr = document.createElement('tr');
            if (idx === state.activeBatchIndex) tr.className = 'active-row';

            const modeBadge = item.mode === 'manual' ? '<span class="badge badge-purple">MANUAL</span>' : '<span class="badge badge-cyan">AUTO</span>';

            tr.innerHTML = `
                <td title="${item.filename}">${item.filename}</td>
                <td>${item.cx.toFixed(1)}</td>
                <td>${item.cy.toFixed(1)}</td>
                <td>${item.radius.toFixed(1)}</td>
                <td>${modeBadge}</td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => setActiveBatchItem(idx));
            elements.summaryTableBody.appendChild(tr);
        });
    }

    function renderReportSection() {
        elements.reportGrid.innerHTML = '';
        if (state.batch.length === 0) {
            elements.reportGrid.innerHTML = '<div class="empty-report-placeholder">No batch report available yet. Load images to view live multi-image report cards.</div>';
            return;
        }

        state.batch.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = `report-card ${idx === state.activeBatchIndex ? 'active-card' : ''}`;
            card.addEventListener('click', () => setActiveBatchItem(idx));

            const badgeClass = item.mode === 'manual' ? 'badge-purple' : 'badge-cyan';
            const areaPx = (Math.PI * item.radius * item.radius).toFixed(1);

            card.innerHTML = `
                <div class="report-card-header">
                    <span class="report-card-filename" title="${item.filename}">${item.filename}</span>
                    <span class="badge ${badgeClass}">${item.mode.toUpperCase()}</span>
                </div>
                <div class="report-thumb-wrapper">
                    <canvas class="report-thumb-canvas" id="report-canvas-${idx}" width="280" height="180"></canvas>
                </div>
                <div class="report-metrics-grid">
                    <div class="report-metric-box">
                        <div class="report-metric-lbl">Center (X, Y)</div>
                        <div class="report-metric-val highlight">${item.cx.toFixed(1)}, ${item.cy.toFixed(1)}</div>
                    </div>
                    <div class="report-metric-box">
                        <div class="report-metric-lbl">Radius (R)</div>
                        <div class="report-metric-val highlight">${item.radius.toFixed(1)} px</div>
                    </div>
                    <div class="report-metric-box">
                        <div class="report-metric-lbl">Area</div>
                        <div class="report-metric-val">${areaPx} px²</div>
                    </div>
                    <div class="report-metric-box">
                        <div class="report-metric-lbl">SNR Ratio</div>
                        <div class="report-metric-val">${item.metrics ? item.metrics.snr : '--'}</div>
                    </div>
                </div>
            `;
            elements.reportGrid.appendChild(card);

            setTimeout(() => drawReportCardThumbnail(idx, item), 0);
        });
    }

    function drawReportCardThumbnail(idx, item) {
        const thumbCanvas = document.getElementById(`report-canvas-${idx}`);
        if (!thumbCanvas || !item.imgElement) return;

        const tCtx = thumbCanvas.getContext('2d');
        const w = thumbCanvas.width;
        const h = thumbCanvas.height;

        tCtx.clearRect(0, 0, w, h);

        if (!item.imgElement.complete) return;

        const scale = Math.min(w / item.imgElement.width, h / item.imgElement.height);
        const offsetX = (w - item.imgElement.width * scale) / 2;
        const offsetY = (h - item.imgElement.height * scale) / 2;

        tCtx.save();
        tCtx.translate(offsetX, offsetY);
        tCtx.scale(scale, scale);

        tCtx.drawImage(item.imgElement, 0, 0);

        const isManual = (item.mode === 'manual');
        const mainColor = isManual ? '#a855f7' : '#00f2fe';
        const shadowColor = isManual ? 'rgba(168, 85, 247, 0.5)' : 'rgba(0, 242, 254, 0.5)';

        tCtx.shadowColor = shadowColor;
        tCtx.shadowBlur = 8 / scale;
        tCtx.strokeStyle = mainColor;
        tCtx.lineWidth = 2.5 / scale;

        tCtx.beginPath();
        tCtx.arc(item.cx, item.cy, item.radius, 0, 2 * Math.PI);
        tCtx.stroke();

        tCtx.fillStyle = isManual ? 'rgba(168, 85, 247, 0.1)' : 'rgba(0, 242, 254, 0.1)';
        tCtx.fill();

        const crossSize = Math.max(10, item.radius * 0.25) / scale;
        tCtx.strokeStyle = mainColor;
        tCtx.lineWidth = 2 / scale;

        tCtx.beginPath();
        tCtx.moveTo(item.cx - crossSize, item.cy); tCtx.lineTo(item.cx + crossSize, item.cy);
        tCtx.moveTo(item.cx, item.cy - crossSize); tCtx.lineTo(item.cx, item.cy + crossSize);
        tCtx.stroke();

        tCtx.restore();
    }

    // Export CSV Download
    async function exportCSV() {
        if (state.batch.length === 0) {
            showToast('No images available to export.', 'error');
            return;
        }

        const itemsPayload = state.batch.map(item => ({
            filename: item.filename,
            source_path: item.sourcePath,
            center_x: item.cx,
            center_y: item.cy,
            radius: item.radius,
            area_px: item.metrics ? item.metrics.area_px : Math.PI * item.radius * item.radius,
            mode: item.mode,
            fit_quality: item.metrics ? item.metrics.fit_quality : 1.0,
            mean_intensity_inside: item.metrics ? item.metrics.mean_intensity_inside : 0.0,
            snr: item.metrics ? item.metrics.snr : 0.0
        }));

        try {
            showToast('Generating CSV file...');
            const response = await fetch('/api/export-csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: itemsPayload })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'fitted_circle_centers.csv';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                showToast('CSV downloaded: fitted_circle_centers.csv');
            } else {
                showToast('CSV export failed.', 'error');
            }
        } catch (err) {
            showToast('Error exporting CSV.', 'error');
        }
    }

    // -------------------------------------------------------------
    // Main Canvas Render Loop
    // -------------------------------------------------------------
    function render() {
        const item = getActiveItem();
        if (!item || !item.imgElement) return;

        const rect = elements.canvasWrapper.getBoundingClientRect();
        elements.mainCanvas.width = rect.width;
        elements.mainCanvas.height = rect.height;

        ctx.clearRect(0, 0, elements.mainCanvas.width, elements.mainCanvas.height);
        ctx.save();

        ctx.translate(state.panX, state.panY);
        ctx.scale(state.scale, state.scale);

        ctx.drawImage(item.imgElement, 0, 0);

        if (state.showGrid) {
            drawGridOverlay(item.imgElement.width, item.imgElement.height);
        }

        drawCircleOverlay(item.cx, item.cy, item.radius, item.mode);

        ctx.restore();
    }

    function drawGridOverlay(w, h) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1 / state.scale;
        const step = 50;
        for (let x = 0; x <= w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y <= h; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(w, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawCircleOverlay(cx, cy, r, mode) {
        ctx.save();
        const isManual = (mode === 'manual');
        const mainColor = isManual ? '#a855f7' : '#00f2fe';
        const shadowColor = isManual ? 'rgba(168, 85, 247, 0.5)' : 'rgba(0, 242, 254, 0.5)';

        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 10 / state.scale;
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2.5 / state.scale;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.fillStyle = isManual ? 'rgba(168, 85, 247, 0.08)' : 'rgba(0, 242, 254, 0.08)';
        ctx.fill();

        const crossSize = Math.max(8, r * 0.2) / state.scale;
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.8 / state.scale;

        ctx.beginPath();
        ctx.moveTo(cx - crossSize, cy); ctx.lineTo(cx + crossSize, cy);
        ctx.moveTo(cx, cy - crossSize); ctx.lineTo(cx, cy + crossSize);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 3 / state.scale, 0, 2 * Math.PI);
        ctx.fill();

        if (isManual) {
            const handleX = cx + r;
            const handleY = cy;
            ctx.fillStyle = '#a855f7';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 / state.scale;
            ctx.beginPath();
            ctx.arc(handleX, handleY, 6 / state.scale, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }

        ctx.font = `${11 / state.scale}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = mainColor;
        ctx.fillText(`(X:${cx.toFixed(1)}, Y:${cy.toFixed(1)}) R:${r.toFixed(1)}px`, cx + r + 10 / state.scale, cy - 10 / state.scale);

        ctx.restore();
    }

    function renderProfilePlot(profile) {
        if (!profile || !profile.r || profile.r.length === 0) return;
        const pCanvas = elements.profileCanvas;
        const pCtx = profileCtx;
        const w = pCanvas.width;
        const h = pCanvas.height;

        pCtx.clearRect(0, 0, w, h);
        const padLeft = 30, padRight = 10, padTop = 15, padBottom = 20;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;
        const maxR = Math.max(...profile.r, 1);
        const maxI = Math.max(...profile.intensity, 255);

        pCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        pCtx.lineWidth = 1;
        pCtx.beginPath();
        pCtx.moveTo(padLeft, padTop); pCtx.lineTo(padLeft, h - padBottom); pCtx.lineTo(w - padRight, h - padBottom);
        pCtx.stroke();

        pCtx.strokeStyle = '#00f2fe';
        pCtx.lineWidth = 2;
        pCtx.beginPath();
        for (let i = 0; i < profile.r.length; i++) {
            const px = padLeft + (profile.r[i] / maxR) * plotW;
            const py = (h - padBottom) - (profile.intensity[i] / maxI) * plotH;
            if (i === 0) pCtx.moveTo(px, py);
            else pCtx.lineTo(px, py);
        }
        pCtx.stroke();

        pCtx.lineTo(padLeft + plotW, h - padBottom);
        pCtx.lineTo(padLeft, h - padBottom);
        pCtx.fillStyle = 'rgba(0, 242, 254, 0.12)';
        pCtx.fill();

        const item = getActiveItem();
        if (item && item.radius <= maxR) {
            const rx = padLeft + (item.radius / maxR) * plotW;
            pCtx.strokeStyle = '#a855f7';
            pCtx.setLineDash([3, 3]);
            pCtx.beginPath();
            pCtx.moveTo(rx, padTop); pCtx.lineTo(rx, h - padBottom);
            pCtx.stroke();
            pCtx.setLineDash([]);
        }

        pCtx.fillStyle = '#94a3b8';
        pCtx.font = '9px sans-serif';
        pCtx.fillText('Radius (px)', w / 2 - 20, h - 4);
    }

    // -------------------------------------------------------------
    // Mouse Interaction (Pan, Zoom, Handle Dragging)
    // -------------------------------------------------------------
    elements.canvasWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        adjustZoom(factor, e.clientX, e.clientY);
    });

    elements.canvasWrapper.addEventListener('mousedown', (e) => {
        const item = getActiveItem();
        if (!item) return;

        const imagePos = screenToImageCoords(e.clientX, e.clientY);

        if (item.mode === 'manual') {
            const distCenter = Math.hypot(imagePos.x - item.cx, imagePos.y - item.cy);
            const distRadiusHandle = Math.hypot(imagePos.x - (item.cx + item.radius), imagePos.y - item.cy);

            if (distRadiusHandle < 15 / state.scale) {
                state.isDraggingRadius = true;
                return;
            }
            if (distCenter < 18 / state.scale) {
                state.isDraggingCenter = true;
                state.dragOffsetX = imagePos.x - item.cx;
                state.dragOffsetY = imagePos.y - item.cy;
                return;
            }
        }

        state.isPanning = true;
        state.startPanX = e.clientX - state.panX;
        state.startPanY = e.clientY - state.panY;
        elements.canvasWrapper.classList.add('grabbing');
    });

    window.addEventListener('mousemove', (e) => {
        const item = getActiveItem();
        if (!item) return;

        const imagePos = screenToImageCoords(e.clientX, e.clientY);
        elements.mouseCoords.textContent = `Cursor: X: ${imagePos.x.toFixed(1)} | Y: ${imagePos.y.toFixed(1)}`;

        if (state.isDraggingCenter) {
            item.cx = Math.round((imagePos.x - state.dragOffsetX) * 10) / 10;
            item.cy = Math.round((imagePos.y - state.dragOffsetY) * 10) / 10;
            updateNumericInputs(item);
            renderSummaryTable();
            renderReportSection();
            render();
            return;
        }

        if (state.isDraggingRadius) {
            const newRadius = Math.hypot(imagePos.x - item.cx, imagePos.y - item.cy);
            item.radius = Math.max(1, Math.round(newRadius * 10) / 10);
            updateNumericInputs(item);
            renderSummaryTable();
            renderReportSection();
            render();
            return;
        }

        if (state.isPanning) {
            state.panX = e.clientX - state.startPanX;
            state.panY = e.clientY - state.startPanY;
            render();
        }
    });

    window.addEventListener('mouseup', () => {
        const item = getActiveItem();
        if (state.isDraggingCenter || state.isDraggingRadius) {
            state.isDraggingCenter = false;
            state.isDraggingRadius = false;
            if (item) triggerReanalyzeItem(item);
        }
        if (state.isPanning) {
            state.isPanning = false;
            elements.canvasWrapper.classList.remove('grabbing');
        }
    });

    function screenToImageCoords(screenX, screenY) {
        const rect = elements.canvasWrapper.getBoundingClientRect();
        const mouseX = screenX - rect.left;
        const mouseY = screenY - rect.top;
        return {
            x: (mouseX - state.panX) / state.scale,
            y: (mouseY - state.panY) / state.scale
        };
    }

    function adjustZoom(factor, anchorScreenX, anchorScreenY) {
        const item = getActiveItem();
        if (!item) return;

        const rect = elements.canvasWrapper.getBoundingClientRect();
        const anchorX = anchorScreenX ? anchorScreenX - rect.left : rect.width / 2;
        const anchorY = anchorScreenY ? anchorScreenY - rect.top : rect.height / 2;
        const newScale = Math.min(Math.max(state.scale * factor, 0.2), 15.0);

        state.panX = anchorX - (anchorX - state.panX) * (newScale / state.scale);
        state.panY = anchorY - (anchorY - state.panY) * (newScale / state.scale);
        state.scale = newScale;
        render();
    }

    function resetView() {
        const item = getActiveItem();
        if (!item || !item.imgElement) return;

        const rect = elements.canvasWrapper.getBoundingClientRect();
        state.scale = Math.min((rect.width - 40) / item.imgElement.width, (rect.height - 40) / item.imgElement.height, 1.5);
        state.panX = (rect.width - item.imgElement.width * state.scale) / 2;
        state.panY = (rect.height - item.imgElement.height * state.scale) / 2;
        render();
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // -------------------------------------------------------------
    // Startup Folder Initialization Check
    // -------------------------------------------------------------
    let startupLoaded = false;

    // 1. Check URL parameters: e.g. http://localhost:8000/?folder=C:\path\to\images
    const urlParams = new URLSearchParams(window.location.search);
    const urlFolder = urlParams.get('folder') || urlParams.get('dir') || urlParams.get('path');

    if (urlFolder) {
        const cleanPath = decodeURIComponent(urlFolder);
        analyzeFolderBatch(cleanPath);
        startupLoaded = true;
    } else {
        // 2. Check Backend Initial Config
        try {
            const cfgRes = await fetch('/api/initial-config');
            const cfgData = await cfgRes.json();
            if (cfgData.default_folder) {
                analyzeFolderBatch(cfgData.default_folder);
                startupLoaded = true;
            }
        } catch (e) {
            console.error('Failed to fetch initial config', e);
        }
    }

    // 3. Fallback: Load 3-image demo batch if no startup folder passed
    if (!startupLoaded) {
        loadDemoBatch3Images();
    }

    window.addEventListener('resize', () => {
        render();
        renderReportSection();
    });
});
