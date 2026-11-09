"""mars-gateway: keys, the board, and the HTTP API end to end."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest
from prometheus_client import CollectorRegistry
from prometheus_client.openmetrics.exposition import generate_latest as om_latest

from mars_gateway.board import Board
from mars_gateway.cli import handler, serve
from mars_gateway.keys import KeyStore, parse_env

# What mars-agent pushes (text format 0.0.4), with the station it was started with.
AGENT = """\
# HELP mars_info MARS identity and liveness
# TYPE mars_info gauge
mars_info{station="other",version="0.1.0"} 1
# TYPE mars_host_cpus gauge
mars_host_cpus{station="other"} 4
# TYPE mars_host_cpu_busy_seconds_total counter
mars_host_cpu_busy_seconds_total{station="other"} 12.5 1700000000000
# TYPE go_goroutines gauge
go_goroutines 7
"""

# What mars-probe pushes (OpenMetrics, with an exemplar).
PROBE = """\
# HELP mars_http_request_duration_seconds d
# TYPE mars_http_request_duration_seconds histogram
mars_http_request_duration_seconds_bucket{le="0.1",station="api"} 1.0 # {status="200"} 0.05
mars_http_request_duration_seconds_bucket{le="+Inf",station="api"} 1.0
mars_http_request_duration_seconds_count{station="api"} 1.0
mars_http_request_duration_seconds_sum{station="api"} 0.05
# EOF
"""
OM = "application/openmetrics-text; version=1.0.0; charset=utf-8"


class Clock:
    t = 100.0

    def __call__(self):
        return self.t


def scrape(board: Board) -> str:
    r = CollectorRegistry(auto_describe=False)
    r.register(board)
    return om_latest(r).decode()


@pytest.fixture
def keys(tmp_path):
    return KeyStore(tmp_path / "keys.json", "fleet:demo-fleet-key")


def test_keys_are_made_kept_and_revoked(tmp_path, keys):
    key, token = keys.create("web hosts", "web")
    assert token.startswith("mars_") and len(token) > 30
    assert keys.check(token) is key and keys.check(token + "x") is None
    saved = (tmp_path / "keys.json").read_text()
    assert token not in saved and key.hash in saved  # only the hash is written
    again = KeyStore(tmp_path / "keys.json")
    assert again.check(token).station == "web"
    assert keys.revoke(key.id) is key and keys.check(token) is None
    assert KeyStore(tmp_path / "keys.json").all() == []


def test_env_keys(keys):
    env = keys.check("demo-fleet-key")
    assert env.station == "fleet" and env.source == "env"
    assert keys.revoke(env.id) is None  # not from the display: can't go
    assert [k.station for k in parse_env("api:aaaaaaaa, search:bbbbbbbb\nx:cccccccc")] == [
        "api",
        "search",
        "x",
    ]
    for bad in ("api", "API:aaaaaaaa", "api:short"):
        with pytest.raises(ValueError):
            parse_env(bad)


@pytest.mark.parametrize("name, station", [("", "web"), ("x" * 49, "web"), ("ok", "Web")])
def test_bad_keys_refused(keys, name, station):
    with pytest.raises(ValueError):
        keys.create(name, station)


def test_board_relabels_filters_and_expires(keys):
    clock = Clock()
    board = Board(ttl=5, clock=clock)
    key, _ = keys.create("web", "web")
    assert board.push(key, "web-1", AGENT, "text/plain") == 3
    out = scrape(board)
    # the key decides the station; the pushed timestamp and non-MARS families are gone
    assert 'mars_info{instance="web-1",station="web",version="0.1.0"} 1.0' in out
    assert 'mars_host_cpu_busy_seconds_total{instance="web-1",station="web"} 12.5\n' in out
    assert "go_goroutines" not in out and 'station="other"' not in out
    assert 'mars_push_up{instance="web-1",station="web"} 1.0' in out

    clock.t += 6
    out = scrape(board)
    assert "mars_info" not in out
    assert 'mars_push_up{instance="web-1",station="web"} 0.0' in out
    assert board.clients(key.id)[0]["live"] is False

    clock.t += 3600
    assert "web-1" not in scrape(board)


def test_board_merges_clients_and_keeps_exemplars(keys):
    board = Board()
    web, _ = keys.create("web", "web")
    api, _ = keys.create("api", "api")
    board.push(web, "web-1", AGENT, "text/plain")
    board.push(web, "web-2", AGENT, "text/plain")
    board.push(api, "api-1", PROBE, OM)
    out = scrape(board)
    assert out.count("# TYPE mars_host_cpus gauge") == 1
    assert 'mars_host_cpus{instance="web-2",station="web"} 4.0' in out
    assert '{instance="api-1",le="0.1",station="api"} 1.0 # {status="200"} 0.05' in out


def test_revoke_reads_down_at_once(keys):
    board = Board()
    key, _ = keys.create("web", "web")
    board.push(key, "web-1", AGENT, "text/plain")
    board.revoke(key.id)
    out = scrape(board)
    assert "mars_info" not in out and 'mars_push_up{instance="web-1",station="web"} 0.0' in out


def test_bad_push_refused(keys):
    key, _ = keys.create("web", "web")
    with pytest.raises(ValueError, match="OpenMetrics"):
        Board().push(key, "web-1", AGENT, OM)  # no # EOF


@pytest.fixture
def server(keys):
    srv = serve("127.0.0.1", 0, handler(keys, Board()))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def call(method, url, body=None, headers=None):
    data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def test_http_round_trip(server):
    status, body = call(
        "POST",
        f"{server}/api/keys",
        json.dumps({"name": "web hosts", "station": "web"}),
        {"Content-Type": "application/json"},
    )
    assert status == 201
    created = json.loads(body)
    token, key_id = created["token"], created["key"]["id"]
    assert "hash" not in created["key"]

    bearer = {"Authorization": f"Bearer {token}", "Content-Type": "text/plain"}
    assert call("POST", f"{server}/push/web-1", AGENT, bearer)[0] == 204
    assert call("POST", f"{server}/push/web-1", AGENT, {"Authorization": "Bearer nope"})[0] == 401
    assert call("POST", f"{server}/push/bad%20name", AGENT, bearer)[0] == 400
    assert call("POST", f"{server}/push/web-1", "\xff garbage{", bearer)[0] == 400

    status, out = call("GET", f"{server}/metrics", headers={"Accept": OM})
    assert status == 200 and 'mars_host_cpus{instance="web-1",station="web"} 4.0' in out
    assert out.endswith("# EOF\n")

    listed = json.loads(call("GET", f"{server}/api/keys")[1])["keys"]
    assert [k["station"] for k in listed] == ["fleet", "web"]
    assert listed[1]["clients"][0]["instance"] == "web-1" and listed[1]["clients"][0]["live"]

    assert call("DELETE", f"{server}/api/keys/{key_id}")[0] == 204
    assert call("DELETE", f"{server}/api/keys/{key_id}")[0] == 404
    assert call("DELETE", f"{server}/api/keys/env-1")[0] == 404
    assert call("POST", f"{server}/push/web-1", AGENT, bearer)[0] == 401


def test_key_creation_wants_json(server):
    form = {"Content-Type": "application/x-www-form-urlencoded"}
    assert call("POST", f"{server}/api/keys", "name=x&station=web", form)[0] == 415
    status, body = call("POST", f"{server}/api/keys", "{}", {"Content-Type": "application/json"})
    assert status == 400 and "name" in json.loads(body)["error"]


def test_key_rotation_has_one_node_and_revocation_respects_new_owner(keys):
    clock = Clock()
    board = Board(clock=clock)
    old, _ = keys.create("old", "api")
    new, _ = keys.create("new", "api")
    board.push(old, "node", AGENT, "text/plain")
    clock.t += 6
    board.push(new, "node", AGENT, "text/plain")
    board.revoke(old.id)
    out = scrape(board)
    assert out.count('mars_push_up{instance="node",station="api"}') == 1
    assert 'mars_push_up{instance="node",station="api"} 1.0' in out
    assert board.clients(old.id) == []
    assert board.clients(new.id)[0]["live"]
    board.revoke(new.id)
    assert 'mars_push_up{instance="node",station="api"} 0.0' in scrape(board)


@pytest.mark.parametrize(
    "body",
    [
        "# TYPE mars_push_up gauge\nmars_push_up 0\n",
        'mars_info{instance="a"} 1\nmars_info{instance="b"} 2\n',
        'mars_info{job="a"} 1\nmars_info{job="b"} 2\n',
    ],
)
def test_conflicting_push_does_not_replace_last_good_reading(keys, body):
    board = Board()
    key, _ = keys.create("api", "api")
    board.push(key, "node", AGENT, "text/plain")
    before = scrape(board)
    with pytest.raises(ValueError, match="reserved|duplicate"):
        board.push(key, "node", body, "text/plain")
    assert scrape(board) == before


def test_in_flight_push_cannot_restore_revoked_key(keys):
    board = Board()
    key, token = keys.create("api", "api")
    authenticated = keys.check(token)
    keys.revoke(key.id)
    board.revoke(key.id)
    with pytest.raises(PermissionError, match="revoked"):
        board.push(authenticated, "new-node", AGENT, "text/plain")
    assert board.clients(key.id) == []


def test_http_push_revoked_while_its_body_is_parsed(server, keys, monkeypatch):
    from mars_gateway import board as board_module

    key, token = keys.create("api", "api")
    entered, release = threading.Event(), threading.Event()
    original = board_module.parse

    def delayed(body, content_type):
        entered.set()
        assert release.wait(5)
        return original(body, content_type)

    monkeypatch.setattr(board_module, "parse", delayed)
    result = []
    request = threading.Thread(
        target=lambda: result.append(
            call("POST", f"{server}/push/node", AGENT, {"Authorization": f"Bearer {token}"})
        )
    )
    request.start()
    try:
        assert entered.wait(5)
        assert call("DELETE", f"{server}/api/keys/{key.id}")[0] == 204
    finally:
        release.set()
        request.join(5)
    assert not request.is_alive()
    assert result[0][0] == 401
    assert "node" not in call("GET", f"{server}/metrics")[1]


def test_station_change_keeps_token_and_persists(keys):
    key, token = keys.create("host", "fleet")
    board = Board()
    board.push(key, "host-1", AGENT, "text/plain")
    assert board.update_station(keys, key.id, "fleet-01") is key
    assert keys.check(token).station == "fleet-01"
    assert KeyStore(keys.path).check(token).station == "fleet-01"
    assert 'station="fleet"' not in scrape(board)
    board.push(key, "host-1", AGENT, "text/plain")
    assert 'station="fleet-01"' in scrape(board)
    assert board.clients(key.id)[0]["live"]
    assert board.update_station(keys, "env-1", "other") is None
    with pytest.raises(ValueError):
        board.update_station(keys, key.id, "Fleet")
    assert keys.check(token).station == "fleet-01"


def test_http_station_change(server, keys):
    key, token = keys.create("host", "fleet")
    url = f"{server}/api/keys/{key.id}"
    headers = {"Content-Type": "application/json"}
    assert call("PATCH", url, '{"station":"fleet-01"}', headers)[0] == 200
    assert call("PATCH", url, '{"station":"Bad"}', headers)[0] == 400
    assert call("PATCH", url, "[]", headers)[0] == 400
    assert call("PATCH", url, "station=x")[0] == 415
    assert call("PATCH", f"{server}/api/keys/env-1", '{"station":"x"}', headers)[0] == 404
    assert (
        call("POST", f"{server}/push/host-1", AGENT, {"Authorization": f"Bearer {token}"})[0] == 204
    )
    metrics = call("GET", f"{server}/metrics")[1]
    assert 'station="fleet-01"' in metrics
    assert 'station="fleet"' not in metrics


def test_station_change_during_push(keys, monkeypatch):
    from mars_gateway import board as module

    key, _ = keys.create("host", "fleet")
    board = Board()
    original = module.parse

    def parse_and_move(body, content_type):
        families = original(body, content_type)
        board.update_station(keys, key.id, "fleet-01")
        return families

    monkeypatch.setattr(module, "parse", parse_and_move)
    board.push(key, "host-1", AGENT, "text/plain")
    assert 'station="fleet"' not in scrape(board)
    assert 'station="fleet-01"' in scrape(board)
