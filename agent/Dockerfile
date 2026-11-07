# mars-agent: one Linux host as a node of a MARS station (README.md, ADR-0009).
#   docker build -t mars-agent agent
# Standard library only, so there is nothing to install: the package is copied in as it is.
FROM python:3.12-alpine

COPY src/mars_agent /app/mars_agent

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MARS_STATION=fleet
# /proc/stat, schedstat, meminfo, pressure and statvfs need no privileges.
USER nobody
EXPOSE 9110
ENTRYPOINT ["python", "-m", "mars_agent"]
