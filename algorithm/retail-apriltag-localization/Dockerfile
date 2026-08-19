FROM python:3.12-slim@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36 AS builder

ARG APRILTAG_COMMIT=94be783968e5091bcc9972c72c84fd63efce2935

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates cmake gcc git make python3-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir numpy==2.2.6 \
    && git clone https://github.com/AprilRobotics/apriltag.git /src/apriltag \
    && git -C /src/apriltag checkout "${APRILTAG_COMMIT}" \
    && test "$(git -C /src/apriltag rev-parse HEAD)" = "${APRILTAG_COMMIT}" \
    && cmake -S /src/apriltag -B /src/apriltag/build \
         -DCMAKE_BUILD_TYPE=Release \
         -DBUILD_EXAMPLES=OFF \
         -DBUILD_PYTHON_WRAPPER=ON \
    && cmake --build /src/apriltag/build --parallel 2 \
    && cmake --install /src/apriltag/build

FROM python:3.12-slim@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36

LABEL org.opencontainers.image.title="Retail AprilTag Localization" \
      org.opencontainers.image.source="https://github.com/AprilRobotics/apriltag" \
      org.opencontainers.image.revision="94be783968e5091bcc9972c72c84fd63efce2935" \
      org.opencontainers.image.licenses="BSD-2-Clause"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LD_LIBRARY_PATH=/usr/local/lib

WORKDIR /app
COPY --from=builder /usr/local/lib/libapriltag.so* /usr/local/lib/
COPY --from=builder /usr/local/lib/python3.12/site-packages/apriltag*.so /usr/local/lib/python3.12/site-packages/
COPY requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir -r /app/requirements.lock \
    && groupadd --gid 10001 algorithm \
    && useradd --uid 10001 --gid 10001 --no-create-home algorithm

COPY retail_apriltag /app/retail_apriltag
USER 10001:10001
ENTRYPOINT ["python", "-m", "retail_apriltag.run"]
