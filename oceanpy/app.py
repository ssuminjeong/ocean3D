import os
from typing import Optional

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
import xarray as xr
import numpy as np
import uvicorn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA_FILE_PATH = os.path.join(os.path.dirname(__file__), "99.data", "HYCOM_120701.nc")
ds = None
coastline_bytes = None
POINT_STRIDE_X = 5
POINT_STRIDE_Y = 5
SPACE_SCALE = 1.6
MAX_DISPLAY_DEPTH_M = 200.0
DEPTH_VIEW_SCALE = 0.18
DEPTH_UNIT_M = 2.0
TARGET_LAT_STEP_DEG = 0.04
DEFAULT_VECTOR_STRIDE = 5
MAX_VECTOR_POINTS = 12_000
MAX_STREAMLINE_SEGMENTS = 25_000


def get_dataset():
    global ds
    if ds is None:
        if not os.path.exists(DATA_FILE_PATH):
            raise FileNotFoundError(f"Dataset not found: {DATA_FILE_PATH}")
        ds = xr.open_dataset(DATA_FILE_PATH, engine="netcdf4")
    return ds


def _clip_index(value: int, length: int) -> int:
    if length <= 0:
        return 0
    return int(max(0, min(value, length - 1)))


def _depth_to_y(depth_m: float) -> float:
    d = max(0.0, float(depth_m))
    return d * DEPTH_VIEW_SCALE


def _to_local_xy_m(lon_vals: np.ndarray, lat_vals: np.ndarray, lon_center: float, lat_center: float) -> tuple[np.ndarray, np.ndarray]:
    x = (lon_vals - lon_center) * SPACE_SCALE
    y = (lat_center - lat_vals) * SPACE_SCALE
    return x, y


def _visible_depth_indices(depth_values: np.ndarray, max_depth_m: float = MAX_DISPLAY_DEPTH_M) -> np.ndarray:
    if depth_values.size == 0:
        return np.array([], dtype=np.int32)
    return np.where(depth_values <= float(max_depth_m))[0].astype(np.int32, copy=False)


def _depth_layer_centers(start_m: float, end_m: float, unit_m: float = DEPTH_UNIT_M) -> np.ndarray:
    start = float(start_m)
    end = float(end_m)
    if end <= start:
        return np.array([], dtype=np.float32)
    count = int(np.floor((end - start) / unit_m))
    if count <= 0:
        return np.array([], dtype=np.float32)
    return (start + (unit_m * 0.5) + (np.arange(count, dtype=np.float32) * unit_m)).astype(np.float32, copy=False)


def _intermediate_latitudes(lat_a: float, lat_b: float, target_step_deg: float = TARGET_LAT_STEP_DEG) -> list[float]:
    gap = abs(float(lat_b) - float(lat_a))
    if gap <= (target_step_deg + 1e-8):
        return []
    segments = int(round(gap / target_step_deg))
    if segments < 2:
        return []
    return [
        float(lat_a + (float(lat_b) - float(lat_a)) * (k / segments))
        for k in range(1, segments)
    ]


def _min_positive_step(values: np.ndarray) -> float:
    if values.size < 2:
        return 0.0
    uniq = np.unique(np.round(values.astype(np.float64), 6))
    if uniq.size < 2:
        return 0.0
    diffs = np.diff(np.sort(uniq))
    diffs = diffs[np.isfinite(diffs) & (diffs > 1e-7)]
    if diffs.size == 0:
        return 0.0
    return float(np.min(diffs))


def _coord_step_map(values: np.ndarray) -> dict[float, float]:
    if values.size == 0:
        return {}
    uniq = np.unique(np.round(values.astype(np.float64), 6))
    uniq = np.sort(uniq)
    if uniq.size == 1:
        return {float(uniq[0]): 1.0}
    step_map = {}
    for i, cur in enumerate(uniq):
        prev_v = uniq[i - 1] if i > 0 else None
        next_v = uniq[i + 1] if i < (uniq.size - 1) else None
        if prev_v is not None and next_v is not None:
            step = float((next_v - prev_v) * 0.5)
        elif next_v is not None:
            step = float(next_v - cur)
        else:
            step = float(cur - prev_v)
        step_map[float(cur)] = max(step, 1e-4)
    return step_map


def _depth_segments(start_m: float, end_m: float, unit_m: float = DEPTH_UNIT_M) -> list[tuple[float, float]]:
    segments: list[tuple[float, float]] = []
    start = float(start_m)
    end = float(end_m)
    if end <= start:
        return segments
    cursor = start
    while (cursor + unit_m) <= (end + 1e-8):
        segments.append((cursor + (unit_m * 0.5), unit_m))
        cursor += unit_m
    rem = end - cursor
    if rem > 1e-6:
        segments.append((cursor + (rem * 0.5), rem))
    return segments


def _time_labels(dataset: xr.Dataset) -> list[str]:
    times = dataset.time.values
    labels = []
    for t in times:
        if isinstance(t, np.datetime64):
            ts = np.datetime_as_string(t, unit="s")
            labels.append(ts.replace("T", " "))
        else:
            labels.append(str(t))
    return labels


def _get_slice(dataset: xr.Dataset, type_name: str, time_idx: int, depth_idx: int):
    time_len = int(dataset.sizes.get("time", 1))
    depth_len = int(dataset.sizes.get("depth", 1))

    safe_time = _clip_index(time_idx, time_len)
    safe_depth = _clip_index(depth_idx, depth_len)

    if type_name == "temp":
        layer = dataset.water_temp.isel(time=safe_time, depth=safe_depth).values
    elif type_name == "salt":
        layer = dataset.salinity.isel(time=safe_time, depth=safe_depth).values
    elif type_name == "current":
        u = dataset.water_u.isel(time=safe_time, depth=safe_depth).values
        v = dataset.water_v.isel(time=safe_time, depth=safe_depth).values
        layer = np.sqrt(u * u + v * v)
    else:
        raise ValueError(f"Unsupported type: {type_name}")

    return layer, safe_time, safe_depth


def _build_point_payload(
    layer_data: np.ndarray,
    lons: np.ndarray,
    lats: np.ndarray,
    depth_values: np.ndarray,
    depth_idx: int,
    stride_x: int = POINT_STRIDE_X,
    stride_y: int = POINT_STRIDE_Y,
):
    lon_center = lons.mean()
    lat_center = lats.mean()
    scale = SPACE_SCALE

    valid_mask = np.isfinite(layer_data)
    safe_stride_y = max(1, int(stride_y))
    safe_stride_x = max(1, int(stride_x))
    y_idx = np.arange(0, layer_data.shape[0], safe_stride_y, dtype=np.int32)
    x_idx = np.arange(0, layer_data.shape[1], safe_stride_x, dtype=np.int32)
    yy, xx = np.meshgrid(y_idx, x_idx, indexing="ij")
    y = yy.ravel()
    x = xx.ravel()
    sampled_valid = valid_mask[y, x]
    y = y[sampled_valid]
    x = x[sampled_valid]

    if len(y) == 0:
        header = np.array([0.0, 0.0], dtype=np.float32)
        return header.tobytes()

    safe_depth_idx = max(0, min(int(depth_idx), len(depth_values) - 1))
    depth_m = float(depth_values[safe_depth_idx]) if len(depth_values) > 0 else float(safe_depth_idx)

    chunks = []
    unique_rows = np.unique(y)
    for idx, row in enumerate(unique_rows):
        row_mask = (y == row)
        row_x = x[row_mask]
        if row_x.size == 0:
            continue
        row_vals = layer_data[row, row_x]
        tx, row_tz = _to_local_xy_m(lons[row_x], np.full(row_x.shape, lats[row], dtype=np.float64), lon_center, lat_center)
        ty = np.full_like(tx, -_depth_to_y(depth_m))
        chunks.append(np.column_stack((tx, ty, row_tz, row_vals)).astype(np.float32))

        if idx >= (unique_rows.size - 1):
            continue

        next_row = int(unique_rows[idx + 1])
        inter_lats = _intermediate_latitudes(float(lats[row]), float(lats[next_row]), TARGET_LAT_STEP_DEG)
        if not inter_lats:
            continue

        next_vals = layer_data[next_row, row_x]
        for k, lat_mid in enumerate(inter_lats, start=1):
            alpha = k / (len(inter_lats) + 1)
            mid_vals = (1.0 - alpha) * row_vals + alpha * next_vals
            _, mid_tz = _to_local_xy_m(
                np.full(row_x.shape, lons[0], dtype=np.float64),
                np.full(row_x.shape, lat_mid, dtype=np.float64),
                lon_center,
                lat_center
            )
            chunks.append(np.column_stack((tx, ty, mid_tz, mid_vals)).astype(np.float32))

    if not chunks:
        header = np.array([0.0, 0.0], dtype=np.float32)
        return header.tobytes()
    final_data = np.concatenate(chunks, axis=0)

    data_min = float(np.nanmin(layer_data))
    data_max = float(np.nanmax(layer_data))
    if not np.isfinite(data_min):
        data_min = 0.0
    if not np.isfinite(data_max):
        data_max = 0.0

    header = np.array([data_min, data_max], dtype=np.float32)
    return header.tobytes() + final_data.tobytes()


def _build_stack_payload(
    data_3d: np.ndarray,
    lons: np.ndarray,
    lats: np.ndarray,
    depth_values: np.ndarray,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    stride_x: int = POINT_STRIDE_X,
    stride_y: int = POINT_STRIDE_Y,
    block_size: int = 5,
):
    lon_center = lons.mean()
    lat_center = lats.mean()

    chunks = []
    depth_fill_layers = 0
    valid_x = np.ones(lons.shape[0], dtype=bool)
    valid_y = np.ones(lats.shape[0], dtype=bool)
    if lon_min is not None:
        valid_x &= lons >= float(lon_min)
    if lon_max is not None:
        valid_x &= lons <= float(lon_max)
    if lat_min is not None:
        valid_y &= lats >= float(lat_min)
    if lat_max is not None:
        valid_y &= lats <= float(lat_max)

    x_candidates = np.where(valid_x)[0]
    y_candidates = np.where(valid_y)[0]
    if x_candidates.size == 0 or y_candidates.size == 0:
        header = np.array([0.0, 0.0], dtype=np.float32)
        return header.tobytes()
    visible_depth_idx = _visible_depth_indices(depth_values, MAX_DISPLAY_DEPTH_M)

    # Compute on full 1x1 base grid; render-time grouping is controlled by block_size.
    safe_block = max(1, int(block_size))
    x_idx = x_candidates.astype(np.int32, copy=False)
    y_idx = y_candidates.astype(np.int32, copy=False)

    lon_edges = compute_edges(lons)
    lat_edges = compute_edges(lats)
    x_edge_local, _ = _to_local_xy_m(lon_edges, np.full_like(lon_edges, lat_center), lon_center, lat_center)
    _, z_edge_local = _to_local_xy_m(np.full_like(lat_edges, lon_center), lat_edges, lon_center, lat_center)

    for idx_pos, d in enumerate(visible_depth_idx):
        layer_data = data_3d[d]

        depth_start = float(depth_values[d]) if d < len(depth_values) else float(d)
        if idx_pos < (visible_depth_idx.size - 1):
            next_idx = int(visible_depth_idx[idx_pos + 1])
            depth_end = float(depth_values[next_idx])
        else:
            depth_end = MAX_DISPLAY_DEPTH_M + DEPTH_UNIT_M
        depth_end = min(depth_end, MAX_DISPLAY_DEPTH_M + DEPTH_UNIT_M)
        depth_segments = _depth_segments(depth_start, depth_end, DEPTH_UNIT_M)
        if not depth_segments:
            continue
        depth_fill_layers += len(depth_segments)

        layer_records = []
        for yi_start in range(0, y_idx.size, safe_block):
            yi_end = min(yi_start + safe_block, y_idx.size)
            y_block = y_idx[yi_start:yi_end]
            if y_block.size == 0:
                continue
            y0 = int(y_block[0])
            yN = int(y_block[-1])
            z_top = float(z_edge_local[y0])
            z_bottom = float(z_edge_local[yN + 1])
            z_center = (z_top + z_bottom) * 0.5
            sz = abs(z_bottom - z_top) * 1.02

            for xi_start in range(0, x_idx.size, safe_block):
                xi_end = min(xi_start + safe_block, x_idx.size)
                x_block = x_idx[xi_start:xi_end]
                if x_block.size == 0:
                    continue
                x0 = int(x_block[0])
                xN = int(x_block[-1])
                x_left = float(x_edge_local[x0])
                x_right = float(x_edge_local[xN + 1])
                x_center = (x_left + x_right) * 0.5
                sx = abs(x_right - x_left) * 1.02

                # Use the first cell in the block, fallback to first finite value.
                value = float(layer_data[y0, x0])
                if not np.isfinite(value):
                    block_values = layer_data[np.ix_(y_block, x_block)].reshape(-1)
                    finite_vals = block_values[np.isfinite(block_values)]
                    if finite_vals.size == 0:
                        continue
                    value = float(finite_vals[0])

                for center_m, height_m in depth_segments:
                    cy = -_depth_to_y(center_m)
                    sy = _depth_to_y(height_m)
                    layer_records.append([x_center, cy, z_center, value, sx, sy, sz])

        if layer_records:
            chunks.append(np.array(layer_records, dtype=np.float32))

    if not chunks:
        header = np.array([0.0, 0.0], dtype=np.float32)
        return header.tobytes()

    final_data = np.concatenate(chunks, axis=0)
    if visible_depth_idx.size == 0:
        header = np.array([0.0, 0.0], dtype=np.float32)
        return header.tobytes()
    visible_data = data_3d[visible_depth_idx]
    data_min = float(np.nanmin(visible_data))
    data_max = float(np.nanmax(visible_data))
    if not np.isfinite(data_min):
        data_min = 0.0
    if not np.isfinite(data_max):
        data_max = 0.0
    header = np.array([data_min, data_max], dtype=np.float32)
    payload = header.tobytes() + final_data.tobytes()
    points = max(0, (len(payload) - 8) // (7 * 4))
    print(
        f"[StackPayload] stride=({stride_x},{stride_y}) depth_unit={DEPTH_UNIT_M}m "
        f"depth_fill_layers={depth_fill_layers} points={points}"
    )
    return payload


def compute_edges(coords: np.ndarray) -> np.ndarray:
    edges = np.empty(coords.size + 1, dtype=np.float64)
    edges[1:-1] = (coords[:-1] + coords[1:]) * 0.5
    edges[0] = coords[0] - (coords[1] - coords[0]) * 0.5
    edges[-1] = coords[-1] + (coords[-1] - coords[-2]) * 0.5
    return edges


def get_coastline_bytes():
    global coastline_bytes
    if coastline_bytes is not None:
        return coastline_bytes

    dataset = get_dataset()
    surface = dataset.water_temp.isel(time=0, depth=0).values
    mask = np.isfinite(surface)
    lons = dataset.lon.values
    lats = dataset.lat.values

    lon_center = lons.mean()
    lat_center = lats.mean()
    scale = SPACE_SCALE

    lon_edges = compute_edges(lons)
    lat_edges = compute_edges(lats)

    segments = []
    h_diff = mask[:, :-1] != mask[:, 1:]
    ys, xs = np.where(h_diff)
    for y, x in zip(ys, xs):
        edge_lon = lon_edges[x + 1]
        lat_top = lat_edges[y]
        lat_bottom = lat_edges[y + 1]
        x_val, z_top_arr = _to_local_xy_m(np.array([edge_lon], dtype=np.float64), np.array([lat_top], dtype=np.float64), lon_center, lat_center)
        _, z_bottom_arr = _to_local_xy_m(np.array([edge_lon], dtype=np.float64), np.array([lat_bottom], dtype=np.float64), lon_center, lat_center)
        x_val = float(x_val[0])
        z_top = float(z_top_arr[0])
        z_bottom = float(z_bottom_arr[0])
        segments.append([x_val, 0.0, z_top, x_val, 0.0, z_bottom])

    v_diff = mask[:-1, :] != mask[1:, :]
    ys, xs = np.where(v_diff)
    for y, x in zip(ys, xs):
        edge_lat = lat_edges[y + 1]
        lon_left = lon_edges[x]
        lon_right = lon_edges[x + 1]
        x_left_arr, z_val_arr = _to_local_xy_m(np.array([lon_left], dtype=np.float64), np.array([edge_lat], dtype=np.float64), lon_center, lat_center)
        x_right_arr, _ = _to_local_xy_m(np.array([lon_right], dtype=np.float64), np.array([edge_lat], dtype=np.float64), lon_center, lat_center)
        x_left = float(x_left_arr[0])
        x_right = float(x_right_arr[0])
        z_val = float(z_val_arr[0])
        segments.append([x_left, 0.0, z_val, x_right, 0.0, z_val])

    if not segments:
        coastline_bytes = b""
        return coastline_bytes

    seg_array = np.array(segments, dtype=np.float32)
    if seg_array.shape[0] > 120_000:
        stride = int(np.ceil(seg_array.shape[0] / 120_000))
        seg_array = seg_array[::stride]

    coastline_bytes = seg_array.tobytes()
    print(f"해안선 세그먼트: {seg_array.shape[0]} lines")
    return coastline_bytes


@app.get("/api/ocean_meta")
def get_ocean_meta():
    try:
        dataset = get_dataset()
        depth_values = np.array(dataset.depth.values, dtype=np.float64)
        visible_depth_idx = _visible_depth_indices(depth_values, MAX_DISPLAY_DEPTH_M)
        visible_depth_values = depth_values[visible_depth_idx]
        return {
            "time_count": int(dataset.sizes.get("time", 1)),
            "depth_count": int(visible_depth_values.size),
            "time_labels": _time_labels(dataset),
            "depth_values": [float(v) for v in visible_depth_values.tolist()],
            "default_vector_stride": DEFAULT_VECTOR_STRIDE,
        }
    except Exception as e:
        return Response(content=f"meta: {e}", status_code=500)


@app.get("/api/ocean_3d")
def get_ocean_3d(type: str = "temp", time_idx: int = 0, depth_idx: int = 0, stride: int = POINT_STRIDE_X):
    try:
        dataset = get_dataset()
        time_len = int(dataset.sizes.get("time", 1))
        depth_len = int(dataset.sizes.get("depth", 1))
        safe_time = _clip_index(time_idx, time_len)
        safe_depth = _clip_index(depth_idx, depth_len)

        safe_stride = max(1, int(stride))

        if type == "temp":
            data_3d = dataset.water_temp.isel(time=safe_time).values
            payload = _build_stack_payload(
                data_3d,
                dataset.lon.values,
                dataset.lat.values,
                dataset.depth.values,
                stride_x=1,
                stride_y=1,
                block_size=safe_stride,
            )
        elif type == "salt":
            data_3d = dataset.salinity.isel(time=safe_time).values
            payload = _build_stack_payload(
                data_3d,
                dataset.lon.values,
                dataset.lat.values,
                dataset.depth.values,
                stride_x=1,
                stride_y=1,
                block_size=safe_stride,
            )
        elif type == "current":
            layer_data, safe_time, safe_depth = _get_slice(dataset, type, safe_time, safe_depth)
            payload = _build_point_payload(
                layer_data, dataset.lon.values, dataset.lat.values, dataset.depth.values, safe_depth, safe_stride, safe_stride
            )
        else:
            return Response(content=f"Unsupported type: {type}", status_code=400)

        point_bytes = (7 * 4) if type in ("temp", "salt") else (4 * 4)
        payload_points = max(0, (len(payload) - 8) // point_bytes)
        print(
            f"[Ocean3D] type={type} time={safe_time} depth={safe_depth} "
            f"stride={safe_stride} payload_points={payload_points} bytes={len(payload)}"
        )
        return Response(content=payload, media_type="application/octet-stream")
    except ValueError as e:
        return Response(content=str(e), status_code=400)
    except Exception as e:
        return Response(content=f"{type}: {e}", status_code=500)


@app.get("/api/ocean_3d_roi")
def get_ocean_3d_roi(
    type: str = "temp",
    time_idx: int = 0,
    stride: int = POINT_STRIDE_X,
    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
):
    try:
        dataset = get_dataset()
        time_len = int(dataset.sizes.get("time", 1))
        safe_time = _clip_index(time_idx, time_len)
        safe_stride = max(1, int(stride))

        if type == "temp":
            data_3d = dataset.water_temp.isel(time=safe_time).values
        elif type == "salt":
            data_3d = dataset.salinity.isel(time=safe_time).values
        else:
            return Response(content=f"Unsupported type for ROI: {type}", status_code=400)

        payload = _build_stack_payload(
            data_3d,
            dataset.lon.values,
            dataset.lat.values,
            dataset.depth.values,
            lon_min=lon_min,
            lon_max=lon_max,
            lat_min=lat_min,
            lat_max=lat_max,
            stride_x=1,
            stride_y=1,
            block_size=safe_stride,
        )
        payload_points = max(0, (len(payload) - 8) // (7 * 4))
        print(
            f"[Ocean3D-ROI] type={type} time={safe_time} stride={safe_stride} "
            f"lon=({lon_min},{lon_max}) lat=({lat_min},{lat_max}) points={payload_points}"
        )
        return Response(content=payload, media_type="application/octet-stream")
    except Exception as e:
        return Response(content=f"ocean_3d_roi: {e}", status_code=500)


@app.get("/api/current_vectors")
def get_current_vectors(time_idx: int = 0, depth_idx: int = 0, stride: int = DEFAULT_VECTOR_STRIDE):
    try:
        dataset = get_dataset()
        time_len = int(dataset.sizes.get("time", 1))
        depth_values_all = np.array(dataset.depth.values, dtype=np.float64)
        visible_depth_idx = _visible_depth_indices(depth_values_all, MAX_DISPLAY_DEPTH_M)
        if visible_depth_idx.size == 0:
            return Response(content="current_vectors: no depth <= 200m", status_code=400)
        depth_len = int(visible_depth_idx.size)

        safe_time = _clip_index(time_idx, time_len)
        safe_depth = _clip_index(depth_idx, depth_len)
        actual_depth_idx = int(visible_depth_idx[safe_depth])
        safe_stride = max(1, int(stride))

        u = dataset.water_u.isel(time=safe_time, depth=actual_depth_idx).values
        v = dataset.water_v.isel(time=safe_time, depth=actual_depth_idx).values
        speed = np.sqrt(u * u + v * v)

        lons = dataset.lon.values
        lats = dataset.lat.values

        valid_mask = np.isfinite(u) & np.isfinite(v) & np.isfinite(speed)

        y_idx = np.arange(0, u.shape[0], safe_stride, dtype=np.int32)
        x_idx = np.arange(0, u.shape[1], safe_stride, dtype=np.int32)
        yy, xx = np.meshgrid(y_idx, x_idx, indexing="ij")
        y = yy.ravel()
        x = xx.ravel()
        sampled_valid = valid_mask[y, x]
        y = y[sampled_valid]
        x = x[sampled_valid]
        if len(y) > MAX_VECTOR_POINTS:
            step = int(np.ceil(len(y) / MAX_VECTOR_POINTS))
            y = y[::step]
            x = x[::step]

        lon_center = lons.mean()
        lat_center = lats.mean()
        scale = SPACE_SCALE

        tx, tz = _to_local_xy_m(lons[x], lats[y], lon_center, lat_center)
        depth_m = float(depth_values_all[actual_depth_idx])
        ty = np.full_like(tx, -_depth_to_y(depth_m))

        du = u[y, x]
        dv = v[y, x]
        dspeed = speed[y, x]

        records = np.column_stack((tx, ty, tz, du, dv, dspeed)).astype(np.float32)

        # streamline용 세그먼트: 점에서 작은 방향 벡터 선분 생성
        vector_scale = 24.0
        ex = tx + du * vector_scale
        ez = tz - dv * vector_scale
        seg = np.column_stack((tx, ty, tz, ex, ty, ez)).astype(np.float32)
        if seg.shape[0] > MAX_STREAMLINE_SEGMENTS:
            seg = seg[:: int(np.ceil(seg.shape[0] / MAX_STREAMLINE_SEGMENTS))]

        speed_min = float(np.nanmin(speed)) if np.isfinite(np.nanmin(speed)) else 0.0
        speed_max = float(np.nanmax(speed)) if np.isfinite(np.nanmax(speed)) else 0.0

        header = np.array([speed_min, speed_max, float(records.shape[0]), float(seg.shape[0])], dtype=np.float32)
        payload = header.tobytes() + records.tobytes() + seg.tobytes()

        return Response(content=payload, media_type="application/octet-stream")
    except Exception as e:
        return Response(content=f"current_vectors: {e}", status_code=500)


@app.get("/api/coastline_3d")
def get_coastline_3d():
    try:
        data = get_coastline_bytes()
        return Response(content=data, media_type="application/octet-stream")
    except Exception as e:
        return Response(content=f"coastline: {e}", status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5002)
