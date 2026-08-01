import cv2
import numpy as np
from PIL import Image
import io
import math

class BrightFeatureAnalyzer:
    """
    Analyzer for detecting and fitting bright round features in grayscale images with dark backgrounds.
    """

    @staticmethod
    def load_image_from_bytes(image_bytes: bytes) -> np.ndarray:
        """Load bytes into 2D numpy grayscale array."""
        image = Image.open(io.BytesIO(image_bytes))
        gray = np.array(image.convert('L'))
        return gray

    @staticmethod
    def load_image_from_path(file_path: str) -> np.ndarray:
        """Load file path into 2D numpy grayscale array."""
        image = Image.open(file_path)
        gray = np.array(image.convert('L'))
        return gray

    @classmethod
    def generate_synthetic_image(
        cls,
        width: int = 600,
        height: int = 600,
        cx: float = 300.0,
        cy: float = 300.0,
        radius: float = 80.0,
        bg_level: float = 25.0,
        peak_intensity: float = 230.0,
        blur_sigma: float = 5.0,
        noise_std: float = 8.0
    ) -> np.ndarray:
        """Generates a synthetic grayscale image with a bright round feature on dark background."""
        y, x = np.ogrid[:height, :width]
        dist_sq = (x - cx)**2 + (y - cy)**2
        
        # Soft circular profile with smooth edge roll-off
        sharpness = 0.3
        spot_mask = 1.0 / (1.0 + np.exp(sharpness * (np.sqrt(dist_sq) - radius)))
        
        img = bg_level + (peak_intensity - bg_level) * spot_mask
        
        # Add gaussian blur for realistic optical point spread
        if blur_sigma > 0:
            img = cv2.GaussianBlur(img, (0, 0), blur_sigma)

        # Add Gaussian noise
        if noise_std > 0:
            noise = np.random.normal(0, noise_std, (height, width))
            img = img + noise

        img = np.clip(img, 0, 255).astype(np.uint8)
        return img

    @classmethod
    def fit_auto(cls, img: np.ndarray) -> dict:
        """
        Robust automatic detection and fitting of the bright round feature.
        """
        h, w = img.shape
        if h == 0 or w == 0:
            raise ValueError("Image is empty.")

        # 1. Preprocessing: Gaussian blur to reduce high-frequency noise
        blurred = cv2.GaussianBlur(img, (9, 9), 2.0)
        
        # Determine background level and peak level
        min_val, max_val, _, max_loc = cv2.minMaxLoc(blurred)
        contrast = max_val - min_val
        
        if contrast < 15:
            # Low contrast fallback: default center of image
            default_cx = w / 2.0
            default_cy = h / 2.0
            default_r = min(w, h) / 6.0
            return cls._compile_metrics(img, default_cx, default_cy, default_r, fit_quality=0.1, mode="auto_fallback")

        # 2. Coarse thresholding: find bright region
        thresh_val, _ = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        threshold_cut = max(thresh_val, min_val + contrast * 0.35)
        
        _, binary = cv2.threshold(blurred, threshold_cut, 255, cv2.THRESH_BINARY)

        # Find contours of bright regions
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        
        init_cx, init_cy, init_r = None, None, None
        
        if contours:
            valid_candidates = []
            for c in contours:
                area = cv2.contourArea(c)
                if area < 25:
                    continue
                perimeter = cv2.arcLength(c, True)
                circularity = 4 * math.pi * area / (perimeter**2) if perimeter > 0 else 0
                
                (ccx, ccy), cr = cv2.minEnclosingCircle(c)
                intensity_at_center = float(blurred[int(np.clip(ccy, 0, h-1)), int(np.clip(ccx, 0, w-1))])
                score = area * (circularity + 0.2) * (intensity_at_center / 255.0)
                valid_candidates.append((score, ccx, ccy, cr, c))

            if valid_candidates:
                valid_candidates.sort(key=lambda x: x[0], reverse=True)
                best_cand = valid_candidates[0]
                init_cx, init_cy, init_r = best_cand[1], best_cand[2], best_cand[3]

        if init_cx is None:
            init_cx, init_cy = float(max_loc[0]), float(max_loc[1])
            init_r = min(w, h) / 8.0

        # 3. Sub-pixel Centroid Refinement around coarse center
        search_radius = max(init_r * 1.6, 20.0)
        x_min = max(0, int(init_cx - search_radius))
        x_max = min(w, int(init_cx + search_radius))
        y_min = max(0, int(init_cy - search_radius))
        y_max = min(h, int(init_cy + search_radius))

        roi_img = img[y_min:y_max, x_min:x_max].astype(np.float64)
        roi_bg = np.percentile(roi_img, 10)
        roi_weights = np.maximum(roi_img - roi_bg, 0) ** 1.5
        
        sum_w = np.sum(roi_weights)
        if sum_w > 0:
            grid_y, grid_x = np.ogrid[y_min:y_max, x_min:x_max]
            subpixel_cx = float(np.sum(grid_x * roi_weights) / sum_w)
            subpixel_cy = float(np.sum(grid_y * roi_weights) / sum_w)
        else:
            subpixel_cx, subpixel_cy = float(init_cx), float(init_cy)

        # 4. Radial Ray Sampling for precise Edge detection & Radius Fitting
        num_rays = 64
        angles = np.linspace(0, 2 * math.pi, num_rays, endpoint=False)
        max_search_dist = int(min(max(init_r * 2.2, 30.0), min(w, h) / 2))
        
        edge_points = []
        for angle in angles:
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            ray_distances = np.arange(3, max_search_dist, 1.0)
            ray_x = subpixel_cx + ray_distances * cos_a
            ray_y = subpixel_cy + ray_distances * sin_a
            
            valid_mask = (ray_x >= 0) & (ray_x < w - 1) & (ray_y >= 0) & (ray_y < h - 1)
            if not np.any(valid_mask):
                continue
                
            r_dist = ray_distances[valid_mask]
            rx = ray_x[valid_mask]
            ry = ray_y[valid_mask]
            
            x0 = rx.astype(int)
            y0 = ry.astype(int)
            x1 = np.minimum(x0 + 1, w - 1)
            y1 = np.minimum(y0 + 1, h - 1)
            
            dx = rx - x0
            dy = ry - y0
            
            intensities = (
                img[y0, x0] * (1 - dx) * (1 - dy) +
                img[y0, x1] * dx * (1 - dy) +
                img[y1, x0] * (1 - dx) * dy +
                img[y1, x1] * dx * dy
            )
            
            intensities_smooth = cv2.GaussianBlur(intensities.astype(np.float32), (5, 1), 1.0).ravel()
            gradients = np.gradient(intensities_smooth)
            min_grad_idx = np.argmin(gradients)
            
            if gradients[min_grad_idx] < -0.5:
                edge_r = r_dist[min_grad_idx]
                edge_x = subpixel_cx + edge_r * cos_a
                edge_y = subpixel_cy + edge_r * sin_a
                edge_points.append((edge_x, edge_y, edge_r))

        # 5. Fit Circle to edge points
        if len(edge_points) >= 6:
            edge_radii = [ep[2] for ep in edge_points]
            fitted_r = float(np.median(edge_radii))
            
            inlier_pts = [ep for ep in edge_points if abs(ep[2] - fitted_r) < 0.35 * fitted_r]
            if len(inlier_pts) >= 5:
                pts_x = np.array([pt[0] for pt in inlier_pts])
                pts_y = np.array([pt[1] for pt in inlier_pts])
                
                A = np.column_stack([pts_x, pts_y, np.ones_like(pts_x)])
                B = -(pts_x**2 + pts_y**2)
                solved, _, _, _ = np.linalg.lstsq(A, B, rcond=None)
                a, b, c = solved
                
                refined_cx = -a / 2.0
                refined_cy = -b / 2.0
                refined_r = math.sqrt(refined_cx**2 + refined_cy**2 - c)
                
                if abs(refined_cx - subpixel_cx) < init_r and abs(refined_cy - subpixel_cy) < init_r and 0.2 * init_r < refined_r < 3.0 * init_r:
                    subpixel_cx, subpixel_cy, fitted_r = float(refined_cx), float(refined_cy), float(refined_r)
        else:
            fitted_r = float(init_r)

        fit_quality = float(min(1.0, max(0.2, len(edge_points) / float(num_rays))))
        return cls._compile_metrics(img, subpixel_cx, subpixel_cy, fitted_r, fit_quality=fit_quality, mode="auto")

    @classmethod
    def fit_manual(cls, img: np.ndarray, cx: float, cy: float, radius: float) -> dict:
        """
        Compute analysis metrics based on user-provided manual circle position and radius.
        """
        return cls._compile_metrics(img, cx, cy, radius, fit_quality=1.0, mode="manual")

    @classmethod
    def _compile_metrics(cls, img: np.ndarray, cx: float, cy: float, r: float, fit_quality: float, mode: str) -> dict:
        """
        Computes detailed summary statistics and radial profile for a given circle parameter.
        """
        h, w = img.shape
        y_grid, x_grid = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((x_grid - cx)**2 + (y_grid - cy)**2)
        
        inside_mask = dist_from_center <= r
        outside_mask = (dist_from_center > r) & (dist_from_center <= r * 2.0)
        
        pixel_count_inside = int(np.sum(inside_mask))
        
        if pixel_count_inside > 0:
            inside_pixels = img[inside_mask]
            mean_intensity_inside = float(np.mean(inside_pixels))
            max_intensity = float(np.max(inside_pixels))
            min_intensity_inside = float(np.min(inside_pixels))
            std_intensity_inside = float(np.std(inside_pixels))
        else:
            mean_intensity_inside = float(img[int(np.clip(cy, 0, h-1)), int(np.clip(cx, 0, w-1))])
            max_intensity = mean_intensity_inside
            min_intensity_inside = mean_intensity_inside
            std_intensity_inside = 0.0

        if np.sum(outside_mask) > 0:
            bg_pixels = img[outside_mask]
            bg_mean = float(np.mean(bg_pixels))
            bg_std = float(np.std(bg_pixels))
        else:
            bg_mean = float(np.percentile(img, 10))
            bg_std = float(np.std(img))

        contrast_ratio = (mean_intensity_inside - bg_mean) / (bg_mean + 1.0e-5)
        signal_to_noise = (mean_intensity_inside - bg_mean) / (bg_std + 1.0e-5)

        max_profile_r = int(min(max(r * 2.2, 10), min(w, h) / 2.0))
        r_bins = np.linspace(0, max_profile_r, 50)
        profile_intensities = []
        
        for i in range(len(r_bins) - 1):
            r_inner = r_bins[i]
            r_outer = r_bins[i+1]
            bin_mask = (dist_from_center >= r_inner) & (dist_from_center < r_outer)
            if np.any(bin_mask):
                profile_intensities.append(float(np.mean(img[bin_mask])))
            else:
                profile_intensities.append(0.0)
                
        profile_r = ((r_bins[:-1] + r_bins[1:]) / 2.0).tolist()

        return {
            "mode": mode,
            "center_x": round(cx, 2),
            "center_y": round(cy, 2),
            "radius": round(r, 2),
            "area_px": round(math.pi * r * r, 1),
            "fit_quality": round(fit_quality, 2),
            "mean_intensity_inside": round(mean_intensity_inside, 2),
            "max_intensity": round(max_intensity, 2),
            "min_intensity_inside": round(min_intensity_inside, 2),
            "std_intensity_inside": round(std_intensity_inside, 2),
            "bg_mean": round(bg_mean, 2),
            "bg_std": round(bg_std, 2),
            "contrast_ratio": round(contrast_ratio, 2),
            "snr": round(signal_to_noise, 2),
            "image_width": w,
            "image_height": h,
            "radial_profile": {
                "r": [round(val, 2) for val in profile_r],
                "intensity": [round(val, 2) for val in profile_intensities]
            }
        }
