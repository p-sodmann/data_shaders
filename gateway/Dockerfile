# mars-gateway: takes pushes from mars-agent and mars-probe for Prometheus (README.md, ADR-0010).
#   docker build -t mars-gateway gateway
FROM python:3.12-alpine

COPY pyproject.toml README.md LICENSE /src/
COPY src /src/src
RUN pip install --no-cache-dir /src && rm -rf /src \
    && mkdir /data && chown nobody /data

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
# The keys made on the display. A named volume here takes this directory's owner (nobody).
VOLUME /data
USER nobody
EXPOSE 9111
ENTRYPOINT ["mars-gateway"]
