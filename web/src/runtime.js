import { CONFIG } from './config.js';
import { createStation } from './station/station.js';

// The device's one station, built from the URL parameters. Step 06 replaces
// this with the stations of the config document.
export const station = createStation({
  id: 'main',
  name: CONFIG.station,
  source:
    CONFIG.source === 'sim'
      ? { kind: 'sim', hosts: CONFIG.hosts, speed: CONFIG.speed }
      : { kind: 'poll', url: CONFIG.source, hosts: CONFIG.hosts },
});
station.start();

// Debug flag: ?stations=2 starts a second sim station (seed 2) that nothing
// displays, and logs both stations' latest latency once per second, to show
// that stations share no state.
if (CONFIG.stations >= 2) {
  const extra = createStation({ id: 'sim2', name: 'SIM-02', source: { kind: 'sim', hosts: CONFIG.hosts, seed: 2, speed: CONFIG.speed } });
  extra.start();
  setInterval(() => {
    const lat = (s) => s.store.latest?.latency?.toFixed(2) ?? '-';
    console.info(`[MARS] stations ${station.id}=${lat(station)}ms ${extra.id}=${lat(extra)}ms`);
  }, 1000);
}
