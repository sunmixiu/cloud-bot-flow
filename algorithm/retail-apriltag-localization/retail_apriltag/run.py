from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
from pathlib import Path

import apriltag
import cv2
import numpy as np


UPSTREAM_REPOSITORY = "https://github.com/AprilRobotics/apriltag"
UPSTREAM_COMMIT = "94be783968e5091bcc9972c72c84fd63efce2935"
UPSTREAM_TAG_IMAGES_COMMIT = "f3fd9a7add5bfd82a886fc65240fdb8e3c9ac5a1"
TAG_FAMILY = "tagStandard41h12"
TAG_ID = 0
TAG_BITS = (
    "001000011",
    "111111111",
    "010000011",
    "110000010",
    "110110011",
    "110101010",
    "010000011",
    "111111111",
    "001011011",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AprilTag convenience-store visual localization")
    parser.add_argument("--input", type=Path, help="Real camera image. Uses the deterministic fixture when omitted.")
    parser.add_argument("--output", type=Path, default=Path("/output"))
    parser.add_argument("--seed", type=int, default=20260819)
    parser.add_argument("--expected-id", type=int, default=TAG_ID)
    parser.add_argument("--tag-size-m", type=float, default=0.12)
    parser.add_argument("--fx", type=float, default=920.0)
    parser.add_argument("--fy", type=float, default=920.0)
    parser.add_argument("--cx", type=float)
    parser.add_argument("--cy", type=float)
    return parser.parse_args()


def render_tag(scale: int = 28) -> np.ndarray:
    cells = np.array([[0 if value == "1" else 255 for value in row] for row in TAG_BITS], dtype=np.uint8)
    return cv2.resize(cells, (cells.shape[1] * scale, cells.shape[0] * scale), interpolation=cv2.INTER_NEAREST)


def build_retail_fixture(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    height, width = 720, 1280
    image = np.full((height, width, 3), (29, 35, 43), dtype=np.uint8)
    cv2.rectangle(image, (0, 0), (width, 88), (245, 247, 250), -1)
    cv2.putText(image, "CONVENIENCE STORE / AISLE 03", (38, 55), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (28, 43, 60), 2, cv2.LINE_AA)

    shelf_left, shelf_right = 80, 1200
    colors = [(48, 127, 226), (36, 178, 122), (232, 150, 45), (196, 75, 83)]
    for row in range(3):
        top = 120 + row * 175
        cv2.rectangle(image, (shelf_left, top), (shelf_right, top + 142), (205, 211, 218), -1)
        cv2.rectangle(image, (shelf_left, top + 142), (shelf_right, top + 158), (86, 96, 108), -1)
        for col in range(8):
            x0 = shelf_left + 20 + col * 136
            item_width = 88 + int(rng.integers(-8, 9))
            item_height = 88 + int(rng.integers(-8, 15))
            y0 = top + 135 - item_height
            color = colors[(row * 3 + col) % len(colors)]
            cv2.rectangle(image, (x0, y0), (x0 + item_width, top + 135), color, -1)
            cv2.rectangle(image, (x0 + 9, y0 + 12), (x0 + item_width - 9, y0 + 30), (245, 245, 245), -1)
            cv2.putText(image, f"{row + 1}{col + 1}", (x0 + 25, top + 124), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (250, 250, 250), 1, cv2.LINE_AA)

    tag = render_tag()
    tag_bgr = cv2.cvtColor(tag, cv2.COLOR_GRAY2BGR)
    src = np.float32([[0, 0], [tag.shape[1] - 1, 0], [tag.shape[1] - 1, tag.shape[0] - 1], [0, tag.shape[0] - 1]])
    dst = np.float32([[906, 425], [1116, 410], [1124, 620], [896, 632]])
    transform = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(tag_bgr, transform, (width, height), borderValue=(255, 255, 255))
    mask = cv2.warpPerspective(np.full(tag.shape, 255, dtype=np.uint8), transform, (width, height))
    image[mask > 0] = warped[mask > 0]
    cv2.rectangle(image, (875, 390), (1145, 660), (230, 234, 239), 3)
    cv2.putText(image, "RESTOCK STATION T-000", (866, 690), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (235, 240, 246), 2, cv2.LINE_AA)

    noise = rng.normal(0.0, 1.2, image.shape).astype(np.int16)
    return np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_dump(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def rotation_matrix_to_euler(rotation: np.ndarray) -> list[float]:
    sy = math.sqrt(rotation[0, 0] ** 2 + rotation[1, 0] ** 2)
    singular = sy < 1e-6
    if not singular:
        x = math.atan2(rotation[2, 1], rotation[2, 2])
        y = math.atan2(-rotation[2, 0], sy)
        z = math.atan2(rotation[1, 0], rotation[0, 0])
    else:
        x = math.atan2(-rotation[1, 2], rotation[1, 1])
        y = math.atan2(-rotation[2, 0], sy)
        z = 0.0
    return [round(math.degrees(value), 4) for value in (x, y, z)]


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    args.output.mkdir(parents=True, exist_ok=True)
    input_mode = "real-camera-image" if args.input else "deterministic-validation-fixture"
    if args.input:
        image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Unable to read input image: {args.input}")
    else:
        image = build_retail_fixture(args.seed)

    input_path = args.output / "input.png"
    if not cv2.imwrite(str(input_path), image):
        raise RuntimeError("Unable to write input evidence")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    detector = apriltag.apriltag(
        TAG_FAMILY,
        threads=max(1, min(4, os.cpu_count() or 1)),
        maxhamming=1,
        decimate=1.0,
        blur=0.0,
        refine_edges=True,
        debug=False,
    )
    detections = list(detector.detect(gray))
    selected = next((item for item in detections if int(item["id"]) == args.expected_id), None)
    if selected is None:
        raise RuntimeError(f"Expected AprilTag id={args.expected_id}, detected {[int(item['id']) for item in detections]}")

    height, width = gray.shape
    fx, fy = args.fx, args.fy
    cx = float(args.cx) if args.cx is not None else width / 2.0
    cy = float(args.cy) if args.cy is not None else height / 2.0
    camera_matrix = np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]], dtype=np.float64)
    half = args.tag_size_m / 2.0
    object_points = np.array([
        [-half, half, 0.0],
        [half, half, 0.0],
        [half, -half, 0.0],
        [-half, -half, 0.0],
    ], dtype=np.float64)
    image_points = np.asarray(selected["lb-rb-rt-lt"], dtype=np.float64)
    success, rotation_vector, translation_vector = cv2.solvePnP(
        object_points,
        image_points,
        camera_matrix,
        np.zeros((5, 1), dtype=np.float64),
        flags=cv2.SOLVEPNP_IPPE_SQUARE,
    )
    if not success:
        raise RuntimeError("solvePnP failed")
    rotation_vector, translation_vector = cv2.solvePnPRefineLM(
        object_points,
        image_points,
        camera_matrix,
        np.zeros((5, 1), dtype=np.float64),
        rotation_vector,
        translation_vector,
    )
    projected, _ = cv2.projectPoints(object_points, rotation_vector, translation_vector, camera_matrix, np.zeros((5, 1)))
    reprojection_error = float(np.sqrt(np.mean(np.sum((projected.reshape(-1, 2) - image_points) ** 2, axis=1))))
    rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
    translation = translation_vector.reshape(3)
    distance_m = float(np.linalg.norm(translation))
    center = [float(value) for value in np.asarray(selected["center"]).tolist()]
    decision_margin = float(selected["margin"])
    hamming = int(selected["hamming"])
    assertions = {
        "expected_tag_detected": int(selected["id"]) == args.expected_id,
        "decision_margin_at_least_40": decision_margin >= 40.0,
        "hamming_distance_at_most_1": hamming <= 1,
        "pose_reprojection_error_below_3px": reprojection_error < 3.0,
        "positive_camera_depth": float(translation[2]) > 0.0,
    }

    annotated = image.copy()
    polygon = np.round(image_points).astype(np.int32).reshape((-1, 1, 2))
    cv2.polylines(annotated, [polygon], True, (38, 226, 142), 4, cv2.LINE_AA)
    cv2.circle(annotated, tuple(np.round(center).astype(int)), 8, (28, 80, 244), -1)
    cv2.drawFrameAxes(annotated, camera_matrix, np.zeros((5, 1)), rotation_vector, translation_vector, args.tag_size_m * 0.55, 3)
    cv2.rectangle(annotated, (26, 100), (650, 218), (13, 22, 34), -1)
    cv2.putText(annotated, f"AprilTag {TAG_FAMILY} / ID {int(selected['id'])}", (48, 139), cv2.FONT_HERSHEY_SIMPLEX, 0.83, (240, 245, 250), 2, cv2.LINE_AA)
    cv2.putText(annotated, f"margin {decision_margin:.2f} | reprojection {reprojection_error:.3f}px", (48, 176), cv2.FONT_HERSHEY_SIMPLEX, 0.64, (96, 225, 170), 2, cv2.LINE_AA)
    cv2.putText(annotated, f"camera distance {distance_m:.3f}m", (48, 207), cv2.FONT_HERSHEY_SIMPLEX, 0.64, (112, 188, 255), 2, cv2.LINE_AA)
    preview_path = args.output / "preview.png"
    cv2.imwrite(str(preview_path), annotated)

    result = {
        "schema_version": "1.0.0",
        "status": "succeeded" if all(assertions.values()) else "failed",
        "publishable": all(assertions.values()),
        "input": {
            "mode": input_mode,
            "path": str(args.input) if args.input else "fixture://retail-aisle-03-apriltag-v1",
            "sha256": sha256_file(input_path),
            "width": width,
            "height": height,
            "production_camera_ready": bool(args.input),
        },
        "algorithm": {
            "name": "AprilTag 3 detector + OpenCV IPPE square pose",
            "family": TAG_FAMILY,
            "upstream_repository": UPSTREAM_REPOSITORY,
            "upstream_commit": UPSTREAM_COMMIT,
            "tag_images_commit": UPSTREAM_TAG_IMAGES_COMMIT,
            "license": "BSD-2-Clause",
        },
        "camera": {"fx": fx, "fy": fy, "cx": cx, "cy": cy, "tag_size_m": args.tag_size_m},
        "detection": {
            "count": len(detections),
            "id": int(selected["id"]),
            "hamming": hamming,
            "decision_margin": round(decision_margin, 6),
            "center_px": [round(value, 4) for value in center],
            "corners_lb_rb_rt_lt_px": np.round(image_points, 4).tolist(),
        },
        "pose": {
            "translation_m": [round(float(value), 6) for value in translation],
            "rotation_vector": [round(float(value), 6) for value in rotation_vector.reshape(3)],
            "euler_xyz_deg": rotation_matrix_to_euler(rotation_matrix),
            "camera_distance_m": round(distance_m, 6),
            "reprojection_error_px": round(reprojection_error, 6),
        },
        "assertions": assertions,
        "runtime": {"elapsed_ms": round((time.perf_counter() - started) * 1000.0, 3)},
        "seed": args.seed,
        "limitations": [] if args.input else [
            "当前运行使用确定性货架图像验证检测器、位姿求解、容器调度和证据链；上线门店前仍需接入真实相机图像。",
            "实际相机必须提供标定后的 fx/fy/cx/cy，并按打印标签实测尺寸配置 tag-size-m。",
        ],
    }
    result_path = args.output / "apriltag-localization.json"
    json_dump(result_path, result)
    checksums = {name: sha256_file(args.output / name) for name in ("input.png", "preview.png", "apriltag-localization.json")}
    json_dump(args.output / "SHA256SUMS.json", checksums)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["publishable"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
