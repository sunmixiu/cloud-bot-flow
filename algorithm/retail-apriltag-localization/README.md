# 便利店 AprilTag 货架工位定位

该封装把 [AprilRobotics/apriltag](https://github.com/AprilRobotics/apriltag) `v3.4.5`（commit `94be783968e5091bcc9972c72c84fd63efce2935`，BSD-2-Clause）编译进 OCI 镜像，通过真实检测器输出标签 ID、检测质量和 6DoF 位姿，并把输入、标注预览、结构化结果和 SHA-256 清单交给 Argo/MinIO 归档。

默认不伪造门店实拍：未传 `--input` 时使用确定性便利店货架验证夹具，结果中的 `input.mode` 和 `production_camera_ready=false` 会明确标识。接现场相机时传入图片和标定参数：

```bash
python -m retail_apriltag.run \
  --input camera.png --output /output \
  --fx 920 --fy 920 --cx 640 --cy 360 --tag-size-m 0.12
```

构建和本地闭环：

```bash
docker build -t localhost:5001/cloud-bot-flow/retail-apriltag-localization:1.0.0 .
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$PWD/evidence:/output" \
  localhost:5001/cloud-bot-flow/retail-apriltag-localization:1.0.0 \
  --output /output --seed 20260819
```

生产接入仍需现场完成相机内参标定、标签打印尺寸测量、光照/遮挡测试和真实图片回归集；平台不会把验证夹具结果标记成“真实相机已就绪”。
